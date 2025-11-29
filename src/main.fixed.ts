import * as fs from 'fs';
import * as path from 'path';
import { Telegraf } from 'telegraf';
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

    let homeOdds = 'N/A';
    let drawOdds = 'N/A';
    let awayOdds = 'N/A';
    
    // Win percentages
    let homeWinPercent = 'N/A';
    let drawPercent = 'N/A';
    let awayWinPercent = 'N/A';
    
    // Best over bet analysis
    let bestOverBet: any = {
      line: 'N/A',
      odds: 'N/A',
      probability: 'N/A',
      recommendation: 'N/A',
      confidence: 0
    };

    try {
      const bookmakers = game.bookmakers || [];
      
      if (bookmakers.length > 0) {
        // Get match winner odds and calculate win percentages
        for (const bm of bookmakers) {
          const h2hMarket = bm.markets?.find((m: any) => m.key === 'h2h');
          if (h2hMarket && h2hMarket.outcomes) {
            const outcomes = h2hMarket.outcomes;
            
            for (const outcome of outcomes) {
              const name = (outcome.name || '').toLowerCase();
              const price = parseFloat(outcome.price || 0);
              const probability = price > 0 ? (1 / price) * 100 : 0;
              const percentStr = `${Math.round(probability * 10) / 10}%`;
              
              if (name === home.toLowerCase()) {
                homeOdds = safeOddsToStr(price);
                homeWinPercent = percentStr;
              } else if (name === 'draw') {
                drawOdds = safeOddsToStr(price);
                drawPercent = percentStr;
              } else if (name === away.toLowerCase()) {
    
Create_file succeeded. Now move file into place using terminal move command.