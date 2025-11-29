import * as fs from 'fs';
import * as path from 'path';
import { Telegraf, Context, Markup } from 'telegraf';
import express from 'express';
import axios from 'axios';
import * as cron from 'node-cron';
import * as winston from 'winston';

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
  ),
  transports: [new winston.transports.Console()],
});

// File paths
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const USERS_FILE = path.join(__dirname, '..', 'users.json');

// Interfaces
interface User {
  user_id: number;
  username: string;
  is_vip: boolean;
  expires: string | null;
  referrals: number;
}

interface Config {
  BOT_TOKEN: string;
  ADMIN_IDS: number[];
  BANK_NAME: string;
  ACCOUNT_NAME: string;
  ACCOUNT_NUMBER: string;
  ODDS_API_KEY?: string;
}

// Express app for keep-alive
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.get('/health', (req, res) => res.json({ status: 'healthy', bot: 'running' }));

// Start Express server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info(`✅ Express keep-alive server started on port ${PORT}`);
});

// Utils: Config & users
function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) {
    const defaultConfig: Config = {
      BOT_TOKEN: '8495534962:AAGiUyX8BLgXDCkRKU2vZ52KPEBqqovtghk',
      ADMIN_IDS: [7417782185],
      BANK_NAME: 'Opay',
      ACCOUNT_NAME: 'Senayon',
      ACCOUNT_NUMBER: '7076644265',
      ODDS_API_KEY: 'bbb2291a75c4af60a6b08bfe1dd9f75c',
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    logger.info(`Created default ${CONFIG_FILE}`);
    return defaultConfig;
  }

  const cfg: Config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  return cfg;
}

function saveConfig(config: Config): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadUsers(): User[] {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    logger.info(`Created ${USERS_FILE}`);
    return [];
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users: User[]): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getUser(userId: number): User | null {
  const users = loadUsers();
  return users.find(u => u.user_id === userId) || null;
}

function isVip(userId: number): boolean {
  const user = getUser(userId);
  if (!user || !user.is_vip) return false;
  if (user.expires) {
    try {
      const expiryDate = new Date(user.expires);
      if (new Date() > expiryDate) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function isAdmin(userId: number): boolean {
  const config = loadConfig();
  return config.ADMIN_IDS.includes(userId);
}

// Helpers: Implied probability + odds parsing
function impliedProbability(odds: string | number): string {
  try {
    const o = parseFloat(odds.toString());
    if (o <= 0) return 'N/A';
    const prob = (1 / o) * 100;
    return `${Math.round(prob * 100) / 100}%`;
  } catch {
    return 'N/A';
  }
}

function safeOddsToStr(val: any): string {
  try {
    return val.toString();
  } catch {
    return 'N/A';
  }
}

// Odds API
async function fetchOdds(sportKey: string, marketTypes: string[]): Promise<any[] | string[]> {
  const apiKey = loadConfig().ODDS_API_KEY;
  if (!apiKey) return ['⚠️ No Odds API key found. Set ODDS_API_KEY in config.json'];

  const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`;
  const params = {
    apiKey,
    regions: 'eu',
    markets: marketTypes.join(','),
    oddsFormat: 'decimal',
    dateFormat: 'iso',
  };

  try {
    const response = await axios.get(url, { params, timeout: 20000 });
    if (response.status !== 200) {
      logger.error(`Odds API error ${response.status}: ${response.data}`);
      return [`⚠️ Error fetching odds (${response.status})`];
    }
    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNABORTED') return ['⚠️ Odds API request timed out.'];
    logger.error(`Exception querying Odds API: ${error.message}`);
    return [`⚠️ Error fetching odds: ${error.message}`];
  }
}

async function getFreeTips(limit: number = 3): Promise<string[]> {
  const events = await fetchOdds('soccer_epl', ['h2h']);
  if (Array.isArray(events) && events.length > 0 && typeof events[0] === 'string' && events[0].startsWith('⚠️')) {
    return events as string[];
  }

  const tips: string[] = [];
  for (const game of events.slice(0, limit)) {
    const home = game.home_team || 'Home';
    const away = game.away_team || 'Away';
    const commence = game.commence_time || 'TBD';

    let homeOdds = 'N/A';
    let awayOdds = 'N/A';
    try {
      const bookmakers = game.bookmakers || [];
      if (bookmakers.length > 0) {
        const bm = bookmakers[0];
        const market = bm.markets?.find((m: any) => m.key === 'h2h');
        if (market) {
          const outcomes = market.outcomes || [];
          if (outcomes.length >= 2) {
            homeOdds = safeOddsToStr(outcomes[0].price || 'N/A');
            awayOdds = safeOddsToStr(outcomes[1].price || 'N/A');
          }
        }
      }
    } catch {}

    tips.push(
      `⚽ ${home} vs ${away}\n• Start: ${commence}\n• Odds — Home: ${homeOdds} | Away: ${awayOdds}\n• 🧮 Win Chances — ${home}: ${impliedProbability(homeOdds)} | ${away}: ${impliedProbability(awayOdds)}`
    );
  }

  return tips.length > 0 ? tips : ['⚠️ Could not parse odds, try again later.'];
}

// Helper function to shuffle array randomly
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// NEW: Daily tips from different leagues (La Liga, Serie A, Bundesliga)
async function getDailyScheduledTips(limit: number = 3): Promise<string[]> {
  // Try multiple leagues for variety
  const leagues = [
    'soccer_spain_la_liga',      // Spanish La Liga
    'soccer_italy_serie_a',      // Italian Serie A
    'soccer_germany_bundesliga', // German Bundesliga
    'soccer_france_ligue_one',   // French Ligue 1
    'soccer_brazil_campeonato',  // Brazilian League
  ];

  // Shuffle leagues for random order
  const shuffledLeagues = shuffleArray(leagues);
  let allTips: string[] = [];

  for (const league of shuffledLeagues) {
    const events = await fetchOdds(league, ['h2h']);
    
    // Skip if error
    if (Array.isArray(events) && events.length > 0 && typeof events[0] === 'string' && events[0].startsWith('⚠️')) {
      continue;
    }

    // Skip if no events
    if (!Array.isArray(events) || events.length === 0) {
      continue;
    }

    // Get league name
    let leagueName = 'Unknown League';
    if (league.includes('la_liga')) leagueName = '🇪🇸 La Liga';
    else if (league.includes('serie_a')) leagueName = '🇮🇹 Serie A';
    else if (league.includes('bundesliga')) leagueName = '🇩🇪 Bundesliga';
    else if (league.includes('ligue_one')) leagueName = '🇫🇷 Ligue 1';
    else if (league.includes('brazil')) leagueName = '🇧🇷 Brasileirão';

    // Shuffle events and pick random match
    const shuffledEvents = shuffleArray(events);
    
    for (const game of shuffledEvents.slice(0, 1)) { // Take 1 random match per league
      const home = game.home_team || 'Home';
      const away = game.away_team || 'Away';
      const commence = game.commence_time || 'TBD';

      let homeOdds = 'N/A';
      let awayOdds = 'N/A';
      let drawOdds = 'N/A';
      try {
        const bookmakers = game.bookmakers || [];
        if (bookmakers.length > 0) {
          const bm = bookmakers[0];
          const market = bm.markets?.find((m: any) => m.key === 'h2h');
          if (market) {
            const outcomes = market.outcomes || [];
            if (outcomes.length >= 2) {
              homeOdds = safeOddsToStr(outcomes[0].price || 'N/A');
              drawOdds = outcomes.length > 2 ? safeOddsToStr(outcomes[1].price || 'N/A') : 'N/A';
              awayOdds = safeOddsToStr(outcomes[outcomes.length - 1].price || 'N/A');
            }
          }
        }
      } catch {}

      allTips.push(
        `${leagueName}\n⚽ ${home} vs ${away}\n• Start: ${commence}\n• Odds — Home: ${homeOdds} | Draw: ${drawOdds} | Away: ${awayOdds}\n• 🧮 Win Chances — ${home}: ${impliedProbability(homeOdds)} | ${away}: ${impliedProbability(awayOdds)}`
      );
    }

    if (allTips.length >= limit) break;
  }

  return allTips.length > 0 ? allTips : ['⚠️ Could not fetch daily tips from other leagues.'];
}

async function getVipTips(limit: number = 3): Promise<string[]> {
  const events = await fetchOdds('soccer_uefa_champs_league', ['totals', 'h2h']);
  if (Array.isArray(events) && events.length > 0 && typeof events[0] === 'string' && events[0].startsWith('⚠️')) {
    return events as string[];
  }

  // Shuffle for variety
  const shuffledEvents = shuffleArray(events);
  const tips: string[] = [];
  
  for (const game of shuffledEvents.slice(0, limit)) {
    const home = game.home_team || 'Home';
    const away = game.away_team || 'Away';
    const commence = game.commence_time || 'TBD';

    let foundTotals = false;
    let line = 'N/A';
    let price = 'N/A';
    try {
      const bookmakers = game.bookmakers || [];
      for (const bm of bookmakers) {
        for (const m of bm.markets || []) {
          if (m.key === 'totals') {
            for (const o of m.outcomes || []) {
              const name = (o.name || '').toLowerCase();
              if (name.includes('over')) {
                line = safeOddsToStr(o.point || 'N/A');
                price = safeOddsToStr(o.price || 'N/A');
                foundTotals = true;
                break;
              }
            }
            if (foundTotals) break;
          }
        }
        if (foundTotals) break;
      }
    } catch {}

    if (foundTotals) {
      tips.push(
        `💎 VIP TIP\n${home} vs ${away}\n• Start: ${commence}\n• Over ${line} Goals @ ${price}\n• 🧮 Implied chance (Over ${line}): ${impliedProbability(price)}`
      );
      continue;
    }

    let homeOdds = 'N/A';
    let awayOdds = 'N/A';
    try {
      const bookmakers = game.bookmakers || [];
      if (bookmakers.length > 0) {
        const market = bookmakers[0].markets?.[0];
        const outcomes = market?.outcomes || [];
        if (outcomes.length >= 2) {
          homeOdds = safeOddsToStr(outcomes[0].price || 'N/A');
          awayOdds = safeOddsToStr(outcomes[1].price || 'N/A');
        }
      }
    } catch {}

    tips.push(
      `💎 VIP TIP\n${home} vs ${away}\n• Start: ${commence}\n• Odds — Home: ${homeOdds} | Away: ${awayOdds}\n• 🧮 Win Chances — ${home}: ${impliedProbability(homeOdds)} | ${away}: ${impliedProbability(awayOdds)}`
    );
  }

  return tips.length > 0 ? tips : ['⚠️ VIP odds unavailable right now.'];
}

// Bot setup
const config = loadConfig();
const bot = new Telegraf(config.BOT_TOKEN);

// Function to send message to your account (linking)
async function sendToUser(userId: number, message: string): Promise<void> {
  try {
    await bot.telegram.sendMessage(userId, message);
    logger.info(`✅ Message sent to user ${userId}`);
  } catch (error) {
    logger.error(`Failed to send message to ${userId}: ${error}`);
  }
}

// Function to send daily tips
async function sendDailyTips(): Promise<void> {
  logger.info('📊 Fetching daily tips for scheduled broadcast...');
  
  try {
    const tips = await getDailyScheduledTips(3); // Using different leagues
    
    if (Array.isArray(tips) && tips.length > 0 && !tips[0].startsWith('⚠️')) {
      const message = '📊 **YOUR DAILY BETTING TIPS**\n\n🌍 Today\'s picks from Europe\'s top leagues:\n\n' + tips.join('\n\n') + '\n\n💡 These are different from /tips command - enjoy the variety!\n\n⚠️ Bet responsibly!';
      await sendToUser(7417782185, message);
      logger.info('✅ Daily tips sent successfully');
    } else {
      logger.warn('⚠️ No valid tips available for daily broadcast');
      await sendToUser(7417782185, '⚠️ Unable to fetch today\'s betting tips. Please try /tips command manually.');
    }
  } catch (error) {
    logger.error(`❌ Error sending daily tips: ${error}`);
  }
}

// Handlers
bot.start(async (ctx) => {
  const user = ctx.from!;
  let users = loadUsers();
  const userExists = users.some(u => u.user_id === user.id);

  let referrerId: number | null = null;
  const args = ctx.message?.text?.split(' ').slice(1);
  if (args && args.length > 0) {
    try {
      referrerId = parseInt(args[0]);
    } catch {}
  }

  if (!userExists) {
    users.push({
      user_id: user.id,
      username: user.username || user.first_name,
      is_vip: false,
      expires: null,
      referrals: 0,
    });

    if (referrerId) {
      const refUser = users.find(u => u.user_id === referrerId);
      if (refUser) refUser.referrals = (refUser.referrals || 0) + 1;
    }

    saveUsers(users);
  }

  const message = `👋 Hello ${user.first_name}!\n\nWelcome to the VIP Betting Tips Bot! 🎯\n\nHere's what you can do:\n- Get free daily betting tips\n- Upgrade to VIP for exclusive high-odds tips\n- Track your VIP status\n- Refer friends to earn free guides\n\n💡 Tip: Type /help to see all available commands and how to use them!`;
  await ctx.reply(message);
});

bot.command('tips', async (ctx) => {
  const realTips = await getFreeTips();
  if (Array.isArray(realTips) && realTips.length > 0 && typeof realTips[0] === 'string' && realTips[0].startsWith('⚠️')) {
    await ctx.reply(realTips[0]);
    return;
  }

  const tipsMessage = '📊 REAL UPCOMING MATCHES & ODDS\n\n' + realTips.join('\n\n') + '\n\n💡 Want premium VIP tips? Use /subscribe\n\n⚠️ These probabilities are *implied* from odds, not guaranteed outcomes.';
  await ctx.reply(tipsMessage);
});

bot.command('refer', async (ctx) => {
  const userId = ctx.from!.id;
  const users = loadUsers();
  const user = users.find(u => u.user_id === userId);

  const botUsername = 'OddsMaster_bot';
  const referralLink = `https://t.me/${botUsername}?start=${userId}`;

  let message = `🎯 Invite your friends to our VIP Betting Tips Bot!\n\n🔗 Share your referral link:\n${referralLink}\n\n`;

  if (user && (user.referrals || 0) > 0) {
    const pdfDownloadLink = 'https://s1.welib-public.org/s2/zlib2/pilimi-zlib2-22300000-22399999/22352133~/1763174096.0UBd9qXHf_cpN2Ja1XAOhg/Sports%20Betting%20to%20Win-%20The%2010%20keys%20to%20disciplined%20and%20--%20Steve,%20Ward%20--%20(WeLib.org).epub';
    message += `📥 Thank you for referring! Download your free betting guide here:\n${pdfDownloadLink}`;
  } else {
    message += '📥 Invite at least one friend to unlock your free betting guide!';
  }

  await ctx.reply(message);
});

bot.command('vip', async (ctx) => {
  const userId = ctx.from!.id;
  if (!isVip(userId)) {
    await ctx.reply('⚠️ You need VIP membership to access premium tips!\n\nUse /subscribe to get VIP access.');
    return;
  }

  const vipList: string[] = await getVipTips();
  if (Array.isArray(vipList) && vipList.length > 0 && typeof vipList[0] === 'string' && vipList[0].startsWith('⚠️')) {
    await ctx.reply(vipList[0]);
    return;
  }

  const vipMessage = '💎 PREMIUM VIP BETTING TIPS\n\n' + vipList.join('\n\n') + '\n\n⚠️ These probabilities are *implied* from odds, not guaranteed outcomes.';
  await ctx.reply(vipMessage);
});

bot.command('help', async (ctx) => {
  const helpMessage = `
📖 **AVAILABLE COMMANDS**

**Free Features:**
/start - Start the bot and register
/help - Show this help message
/tips - Get free daily betting tips with real odds
/refer - Get your referral link and invite friends

**VIP Features:**
/vip - Access premium VIP betting tips (requires VIP membership)
/subscribe - Subscribe to VIP membership for $10/month
/status - Check your VIP subscription status

**Admin Commands:**
/pending - View pending payment verifications
/approve - Approve a user's VIP subscription
/revoke - Revoke a user's VIP access

**How to Use:**
• Use /tips to get free Premier League betting predictions
• Upgrade to VIP with /subscribe for exclusive Champions League tips
• Share your /refer link to earn free betting guides
• VIP members get access to higher-odds tips and advanced analytics

**About the Tips:**
• All odds are fetched in real-time from bookmakers
• Implied probabilities show the statistical chance of outcomes
• Tips are for informational purposes - bet responsibly

💡 **Need help?** Contact support or check your VIP status anytime!
  `.trim();

  await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('subscribe', async (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name;

  if (isVip(userId)) {
    const user = getUser(userId);
    const expiryDate = user?.expires ? new Date(user.expires).toLocaleDateString() : 'Lifetime';
    await ctx.reply(`✅ You already have VIP access!\n\n📅 Expires: ${expiryDate}\n\nUse /vip to get premium tips.`);
    return;
  }

  const config = loadConfig();
  const subscriptionMessage = `
💎 **VIP SUBSCRIPTION - $10/month**

**Benefits:**
✅ Exclusive Champions League betting tips
✅ Advanced analytics and probability calculations
✅ Higher odds selections
✅ Priority support
✅ Daily premium predictions

**Payment Instructions:**

**Bank Name:** ${config.BANK_NAME}
**Account Name:** ${config.ACCOUNT_NAME}
**Account Number:** ${config.ACCOUNT_NUMBER}
**Amount:** $10 USD (or equivalent)

📸 **After payment:**
1. Take a screenshot of your payment confirmation
2. Send the screenshot to this bot
3. Admin will verify and activate your VIP access within 24 hours

⏰ Your VIP access will be valid for 30 days from approval.

💡 Having trouble? Contact admin for assistance.
  `.trim();

  await ctx.reply(subscriptionMessage, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  const userId = ctx.from!.id;
  const user = getUser(userId);

  if (!user) {
    await ctx.reply('⚠️ You are not registered. Use /start to register.');
    return;
  }

  const vipStatus = isVip(userId);
  let statusMessage = `📊 **YOUR ACCOUNT STATUS**\n\n`;
  statusMessage += `👤 Username: ${user.username}\n`;
  statusMessage += `🆔 User ID: ${user.user_id}\n`;
  statusMessage += `👥 Referrals: ${user.referrals || 0}\n\n`;

  if (vipStatus) {
    const expiryDate = user.expires ? new Date(user.expires).toLocaleDateString() : 'Lifetime';
    statusMessage += `💎 VIP Status: **ACTIVE** ✅\n`;
    statusMessage += `📅 Expires: ${expiryDate}\n\n`;
    statusMessage += `Use /vip to access premium tips!`;
  } else {
    statusMessage += `💎 VIP Status: **INACTIVE** ❌\n\n`;
    statusMessage += `Use /subscribe to upgrade to VIP!`;
  }

  await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
});

// Handle photo uploads (payment screenshots)
bot.on('photo', async (ctx) => {
  const userId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name;
  const config = loadConfig();

  // Save photo info for admin review
  const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
  
  // Notify user
  await ctx.reply('📸 Payment screenshot received!\n\n⏳ Your payment is being reviewed by admin. You will be notified once your VIP access is activated.\n\n⏰ This usually takes up to 24 hours.');

  // Notify admin
  for (const adminId of config.ADMIN_IDS) {
    try {
      await bot.telegram.sendPhoto(adminId, photoId, {
        caption: `💳 **NEW PAYMENT SUBMISSION**\n\n👤 User: ${username}\n🆔 User ID: ${userId}\n\n📸 Payment screenshot attached.\n\nUse the buttons below to approve or reject.`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve (30 days)', callback_data: `approve_${userId}_30` },
              { text: '❌ Reject', callback_data: `reject_${userId}` }
            ],
            [
              { text: '✅ Approve (Lifetime)', callback_data: `approve_${userId}_lifetime` }
            ]
          ]
        }
      });
    } catch (error) {
      logger.error(`Failed to notify admin ${adminId}: ${error}`);
    }
  }
});

// Handle admin approval/rejection buttons
bot.on('callback_query', async (ctx) => {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
    return;
  }
  
  const callbackData = ctx.callbackQuery.data;
  const adminId = ctx.from!.id;

  if (!isAdmin(adminId)) {
    await ctx.answerCbQuery('⚠️ You are not authorized to perform this action.');
    return;
  }

  const parts = callbackData.split('_');
  const action = parts[0];
  const targetUserId = parseInt(parts[1]);
  const duration = parts[2];

  if (action === 'approve') {
    let users = loadUsers();
    let user = users.find(u => u.user_id === targetUserId);

    if (!user) {
      // Create user if doesn't exist
      user = {
        user_id: targetUserId,
        username: 'Unknown',
        is_vip: false,
        expires: null,
        referrals: 0
      };
      users.push(user);
    }

    user.is_vip = true;
    
    if (duration === 'lifetime') {
      user.expires = null;
    } else {
      const days = parseInt(duration);
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);
      user.expires = expiryDate.toISOString();
    }

    saveUsers(users);

    // Notify user
    try {
      const expiryMsg = duration === 'lifetime' ? 'Lifetime access' : `Valid for ${duration} days`;
      await bot.telegram.sendMessage(targetUserId, `🎉 **CONGRATULATIONS!**\n\n✅ Your VIP subscription has been activated!\n\n📅 ${expiryMsg}\n\n💎 Use /vip to access premium betting tips now!\n\nThank you for subscribing! 🙏`, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error(`Failed to notify user ${targetUserId}: ${error}`);
    }

    await ctx.answerCbQuery('✅ User approved and VIP access granted!');
    await ctx.editMessageCaption(`✅ **APPROVED**\n\n👤 User ID: ${targetUserId}\n📅 Duration: ${duration === 'lifetime' ? 'Lifetime' : duration + ' days'}\n👮 Approved by: Admin ${adminId}`, { parse_mode: 'Markdown' });

  } else if (action === 'reject') {
    // Notify user
    try {
      await bot.telegram.sendMessage(targetUserId, '❌ **PAYMENT VERIFICATION FAILED**\n\nYour payment could not be verified. Please ensure:\n\n1. You sent the correct amount ($10)\n2. Payment was made to the correct account\n3. Screenshot is clear and shows transaction details\n\nPlease contact admin if you believe this is an error.', { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error(`Failed to notify user ${targetUserId}: ${error}`);
    }

    await ctx.answerCbQuery('❌ Payment rejected');
    await ctx.editMessageCaption(`❌ **REJECTED**\n\n👤 User ID: ${targetUserId}\n👮 Rejected by: Admin ${adminId}`, { parse_mode: 'Markdown' });
  }
});

// Admin command to view pending payments
bot.command('pending', async (ctx) => {
  const userId = ctx.from!.id;
  
  if (!isAdmin(userId)) {
    await ctx.reply('⚠️ This command is only available to administrators.');
    return;
  }

  await ctx.reply('📋 Check your messages above for pending payment verifications.\n\nNew payment screenshots will appear here automatically.');
});

// Admin command to manually approve VIP
bot.command('approve', async (ctx) => {
  const userId = ctx.from!.id;
  
  if (!isAdmin(userId)) {
    await ctx.reply('⚠️ This command is only available to administrators.');
    return;
  }

  const args = ctx.message?.text?.split(' ');
  if (!args || args.length < 2) {
    await ctx.reply('Usage: /approve <user_id> [days]\n\nExample:\n/approve 123456789 30\n/approve 123456789 lifetime');
    return;
  }

  const targetUserId = parseInt(args[1]);
  const duration = args[2] || '30';

  let users = loadUsers();
  let user = users.find(u => u.user_id === targetUserId);

  if (!user) {
    await ctx.reply('⚠️ User not found. They need to /start the bot first.');
    return;
  }

  user.is_vip = true;
  
  if (duration === 'lifetime') {
    user.expires = null;
  } else {
    const days = parseInt(duration);
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    user.expires = expiryDate.toISOString();
  }

  saveUsers(users);

  // Notify user
  try {
    const expiryMsg = duration === 'lifetime' ? 'Lifetime access' : `Valid for ${duration} days`;
    await bot.telegram.sendMessage(targetUserId, `🎉 **CONGRATULATIONS!**\n\n✅ Your VIP subscription has been activated!\n\n📅 ${expiryMsg}\n\n💎 Use /vip to access premium betting tips now!`, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error(`Failed to notify user ${targetUserId}: ${error}`);
  }

  await ctx.reply(`✅ VIP access granted to user ${targetUserId}\n📅 Duration: ${duration === 'lifetime' ? 'Lifetime' : duration + ' days'}`);
});

// Admin command to revoke VIP
bot.command('revoke', async (ctx) => {
  const userId = ctx.from!.id;
  
  if (!isAdmin(userId)) {
    await ctx.reply('⚠️ This command is only available to administrators.');
    return;
  }

  const args = ctx.message?.text?.split(' ');
  if (!args || args.length < 2) {
    await ctx.reply('Usage: /revoke <user_id>\n\nExample: /revoke 123456789');
    return;
  }

  const targetUserId = parseInt(args[1]);
  let users = loadUsers();
  let user = users.find(u => u.user_id === targetUserId);

  if (!user) {
    await ctx.reply('⚠️ User not found.');
    return;
  }

  user.is_vip = false;
  user.expires = null;
  saveUsers(users);

  // Notify user
  try {
    await bot.telegram.sendMessage(targetUserId, '❌ Your VIP subscription has been revoked.\n\nIf you believe this is an error, please contact admin.', { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error(`Failed to notify user ${targetUserId}: ${error}`);
  }

  await ctx.reply(`✅ VIP access revoked from user ${targetUserId}`);
});

// TEST COMMAND: Manually trigger daily tips (Admin only)
bot.command('testdaily', async (ctx) => {
  const userId = ctx.from!.id;
  
  logger.info(`📝 /testdaily command received from user ${userId}`);
  
  if (!isAdmin(userId)) {
    await ctx.reply(`⚠️ This command is only available to administrators.\n\nYour User ID: ${userId}\nAdmin IDs: ${loadConfig().ADMIN_IDS.join(', ')}`);
    return;
  }

  await ctx.reply('🧪 Testing daily tips broadcast...');
  logger.info('🧪 Manually triggering daily tips...');
  await sendDailyTips();
  await ctx.reply('✅ Test completed! Check if you received the tips message.');
});

// DEBUG COMMAND: Check if cron is working
bot.command('crontest', async (ctx) => {
  const userId = ctx.from!.id;
  
  if (!isAdmin(userId)) {
    await ctx.reply('⚠️ Admin only command.');
    return;
  }

  const now = new Date();
  const lagosTime = now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' });
  
  await ctx.reply(`⏰ **CRON STATUS**\n\n🕐 Current Server Time: ${now.toLocaleString()}\n🌍 Lagos Time: ${lagosTime}\n\n✅ Bot is running\n📅 Cron schedule: Every 1 minute (test mode)\n\nCheck console logs for cron triggers.`, { parse_mode: 'Markdown' });
});

// FIXED: Scheduled job - Send daily tips at 10:00 AM every day
// For TESTING: Use '*/1 * * * *' to run every minute
// For PRODUCTION: Use '0 10 * * *' for 10:00 AM daily
const cronSchedule = '*/1 * * * *'; // Change this to '0 10 * * *' after testing

const cronJob = cron.schedule(cronSchedule, async () => {
  const now = new Date();
  logger.info(`⏰ Cron job triggered at ${now.toLocaleString()}`);
  await sendDailyTips();
}, {
  scheduled: true,
  timezone: "Africa/Lagos"
});

logger.info(`📅 Scheduled daily tips job configured: ${cronSchedule} (Africa/Lagos timezone)`);
logger.info(`🕐 Current server time: ${new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' })}`);
logger.info('⚠️ NOTE: Change cronSchedule to "0 10 * * *" for production (10:00 AM daily)');

// Launch bot
bot.launch();
logger.info('🚀 Bot started successfully!');
logger.info('📊 Daily tips will be sent at 10:00 AM every day');

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));