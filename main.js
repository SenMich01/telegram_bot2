"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var telegraf_1 = require("telegraf");
var express_1 = require("express");
var axios_1 = require("axios");
var cron = require("node-cron");
var winston = require("winston");
// Logger setup
var logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.printf(function (_a) {
        var timestamp = _a.timestamp, level = _a.level, message = _a.message;
        return "".concat(timestamp, " [").concat(level.toUpperCase(), "]: ").concat(message);
    })),
    transports: [new winston.transports.Console()],
});
// File paths
var CONFIG_FILE = path.join(__dirname, '..', 'config.json');
var USERS_FILE = path.join(__dirname, '..', 'users.json');
// Express app for keep-alive
var app = (0, express_1.default)();
app.get('/', function (req, res) { return res.send('Bot is running!'); });
app.get('/health', function (req, res) { return res.json({ status: 'healthy', bot: 'running' }); });
// Start Express server
var PORT = process.env.PORT || 8080;
app.listen(PORT, function () {
    logger.info("\u2705 Express keep-alive server started on port ".concat(PORT));
});
// Utils: Config & users
function loadConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        var defaultConfig = {
            BOT_TOKEN: '8495534962:AAGiUyX8BLgXDCkRKU2vZ52KPEBqqovtghk',
            ADMIN_IDS: [7417782185],
            BANK_NAME: 'Opay',
            ACCOUNT_NAME: 'Senayon',
            ACCOUNT_NUMBER: '7076644265',
            ODDS_API_KEY: 'bbb2291a75c4af60a6b08bfe1dd9f75c',
        };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
        logger.info("Created default ".concat(CONFIG_FILE));
        return defaultConfig;
    }
    var cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return cfg;
}
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
        logger.info("Created ".concat(USERS_FILE));
        return [];
    }
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function getUser(userId) {
    var users = loadUsers();
    return users.find(function (u) { return u.user_id === userId; }) || null;
}
function isVip(userId) {
    var user = getUser(userId);
    if (!user || !user.is_vip)
        return false;
    if (user.expires) {
        try {
            var expiryDate = new Date(user.expires);
            if (new Date() > expiryDate)
                return false;
        }
        catch (_a) {
            return false;
        }
    }
    return true;
}
function isAdmin(userId) {
    var config = loadConfig();
    return config.ADMIN_IDS.includes(userId);
}
// Helpers: Implied probability + odds parsing
function impliedProbability(odds) {
    try {
        var o = parseFloat(odds.toString());
        if (o <= 0)
            return 'N/A';
        var prob = (1 / o) * 100;
        return "".concat(Math.round(prob * 100) / 100, "%");
    }
    catch (_a) {
        return 'N/A';
    }
}
function safeOddsToStr(val) {
    try {
        return val.toString();
    }
    catch (_a) {
        return 'N/A';
    }
}
// Odds API
function fetchOdds(sportKey, marketTypes) {
    return __awaiter(this, void 0, void 0, function () {
        var apiKey, url, params, response, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    apiKey = loadConfig().ODDS_API_KEY;
                    if (!apiKey)
                        return [2 /*return*/, ['⚠️ No Odds API key found. Set ODDS_API_KEY in config.json']];
                    url = "https://api.the-odds-api.com/v4/sports/".concat(sportKey, "/odds/");
                    params = {
                        apiKey: apiKey,
                        regions: 'eu',
                        markets: marketTypes.join(','),
                        oddsFormat: 'decimal',
                        dateFormat: 'iso',
                    };
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, axios_1.default.get(url, { params: params, timeout: 20000 })];
                case 2:
                    response = _a.sent();
                    if (response.status !== 200) {
                        logger.error("Odds API error ".concat(response.status, ": ").concat(response.data));
                        return [2 /*return*/, ["\u26A0\uFE0F Error fetching odds (".concat(response.status, ")")]];
                    }
                    return [2 /*return*/, response.data];
                case 3:
                    error_1 = _a.sent();
                    if (error_1.code === 'ECONNABORTED')
                        return [2 /*return*/, ['⚠️ Odds API request timed out.']];
                    logger.error("Exception querying Odds API: ".concat(error_1.message));
                    return [2 /*return*/, ["\u26A0\uFE0F Error fetching odds: ".concat(error_1.message)]];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function getFreeTips() {
    return __awaiter(this, arguments, void 0, function (limit) {
        var events, tips, _i, _a, game, home, away, commence, homeOdds, awayOdds, bookmakers, bm, market, outcomes;
        var _b;
        if (limit === void 0) { limit = 3; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, fetchOdds('soccer_epl', ['h2h'])];
                case 1:
                    events = _c.sent();
                    if (Array.isArray(events) && events.length > 0 && typeof events[0] === 'string' && events[0].startsWith('⚠️')) {
                        return [2 /*return*/, events];
                    }
                    tips = [];
                    for (_i = 0, _a = events.slice(0, limit); _i < _a.length; _i++) {
                        game = _a[_i];
                        home = game.home_team || 'Home';
                        away = game.away_team || 'Away';
                        commence = game.commence_time || 'TBD';
                        homeOdds = 'N/A';
                        awayOdds = 'N/A';
                        try {
                            bookmakers = game.bookmakers || [];
                            if (bookmakers.length > 0) {
                                bm = bookmakers[0];
                                market = (_b = bm.markets) === null || _b === void 0 ? void 0 : _b.find(function (m) { return m.key === 'h2h'; });
                                if (market) {
                                    outcomes = market.outcomes || [];
                                    if (outcomes.length >= 2) {
                                        homeOdds = safeOddsToStr(outcomes[0].price || 'N/A');
                                        awayOdds = safeOddsToStr(outcomes[1].price || 'N/A');
                                    }
                                }
                            }
                        }
                        catch (_d) { }
                        tips.push("\u26BD ".concat(home, " vs ").concat(away, "\n\u2022 Start: ").concat(commence, "\n\u2022 Odds \u2014 Home: ").concat(homeOdds, " | Away: ").concat(awayOdds, "\n\u2022 \uD83E\uDDEE Win Chances \u2014 ").concat(home, ": ").concat(impliedProbability(homeOdds), " | ").concat(away, ": ").concat(impliedProbability(awayOdds)));
                    }
                    return [2 /*return*/, tips.length > 0 ? tips : ['⚠️ Could not parse odds, try again later.']];
            }
        });
    });
}
function getVipTips() {
    return __awaiter(this, arguments, void 0, function (limit) {
        var events, tips, _i, _a, game, home, away, commence, foundTotals, line, price, bookmakers, _b, bookmakers_1, bm, _c, _d, m, _e, _f, o, name_1, homeOdds, awayOdds, bookmakers, market, outcomes;
        var _g;
        if (limit === void 0) { limit = 3; }
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0: return [4 /*yield*/, fetchOdds('soccer_uefa_champs_league', ['totals', 'h2h'])];
                case 1:
                    events = _h.sent();
                    if (Array.isArray(events) && events.length > 0 && typeof events[0] === 'string' && events[0].startsWith('⚠️')) {
                        return [2 /*return*/, events];
                    }
                    tips = [];
                    for (_i = 0, _a = events.slice(0, limit); _i < _a.length; _i++) {
                        game = _a[_i];
                        home = game.home_team || 'Home';
                        away = game.away_team || 'Away';
                        commence = game.commence_time || 'TBD';
                        foundTotals = false;
                        line = 'N/A';
                        price = 'N/A';
                        try {
                            bookmakers = game.bookmakers || [];
                            for (_b = 0, bookmakers_1 = bookmakers; _b < bookmakers_1.length; _b++) {
                                bm = bookmakers_1[_b];
                                for (_c = 0, _d = bm.markets || []; _c < _d.length; _c++) {
                                    m = _d[_c];
                                    if (m.key === 'totals') {
                                        for (_e = 0, _f = m.outcomes || []; _e < _f.length; _e++) {
                                            o = _f[_e];
                                            name_1 = (o.name || '').toLowerCase();
                                            if (name_1.includes('over')) {
                                                line = safeOddsToStr(o.point || 'N/A');
                                                price = safeOddsToStr(o.price || 'N/A');
                                                foundTotals = true;
                                                break;
                                            }
                                        }
                                        if (foundTotals)
                                            break;
                                    }
                                }
                                if (foundTotals)
                                    break;
                            }
                        }
                        catch (_j) { }
                        if (foundTotals) {
                            tips.push("\uD83D\uDC8E VIP TIP\n".concat(home, " vs ").concat(away, "\n\u2022 Start: ").concat(commence, "\n\u2022 Over ").concat(line, " Goals @ ").concat(price, "\n\u2022 \uD83E\uDDEE Implied chance (Over ").concat(line, "): ").concat(impliedProbability(price)));
                            continue;
                        }
                        homeOdds = 'N/A';
                        awayOdds = 'N/A';
                        try {
                            bookmakers = game.bookmakers || [];
                            if (bookmakers.length > 0) {
                                market = (_g = bookmakers[0].markets) === null || _g === void 0 ? void 0 : _g[0];
                                outcomes = (market === null || market === void 0 ? void 0 : market.outcomes) || [];
                                if (outcomes.length >= 2) {
                                    homeOdds = safeOddsToStr(outcomes[0].price || 'N/A');
                                    awayOdds = safeOddsToStr(outcomes[1].price || 'N/A');
                                }
                            }
                        }
                        catch (_k) { }
                        tips.push("\uD83D\uDC8E VIP TIP\n".concat(home, " vs ").concat(away, "\n\u2022 Start: ").concat(commence, "\n\u2022 Odds \u2014 Home: ").concat(homeOdds, " | Away: ").concat(awayOdds, "\n\u2022 \uD83E\uDDEE Win Chances \u2014 ").concat(home, ": ").concat(impliedProbability(homeOdds), " | ").concat(away, ": ").concat(impliedProbability(awayOdds)));
                    }
                    return [2 /*return*/, tips.length > 0 ? tips : ['⚠️ VIP odds unavailable right now.']];
            }
        });
    });
}
// Bot setup
var config = loadConfig();
var bot = new telegraf_1.Telegraf(config.BOT_TOKEN);
// Function to send message to your account (linking)
function sendToUser(userId, message) {
    return __awaiter(this, void 0, void 0, function () {
        var error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, bot.telegram.sendMessage(userId, message)];
                case 1:
                    _a.sent();
                    return [3 /*break*/, 3];
                case 2:
                    error_2 = _a.sent();
                    logger.error("Failed to send message to ".concat(userId, ": ").concat(error_2));
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// Handlers
bot.start(function (ctx) { return __awaiter(void 0, void 0, void 0, function () {
    var user, users, userExists, referrerId, args, refUser, message;
    var _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                user = ctx.from;
                users = loadUsers();
                userExists = users.some(function (u) { return u.user_id === user.id; });
                referrerId = null;
                args = (_b = (_a = ctx.message) === null || _a === void 0 ? void 0 : _a.text) === null || _b === void 0 ? void 0 : _b.split(' ').slice(1);
                if (args && args.length > 0) {
                    try {
                        referrerId = parseInt(args[0]);
                    }
                    catch (_d) { }
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
                        refUser = users.find(function (u) { return u.user_id === referrerId; });
                        if (refUser)
                            refUser.referrals = (refUser.referrals || 0) + 1;
                    }
                    saveUsers(users);
                }
                message = "\uD83D\uDC4B Hello ".concat(user.first_name, "!\n\nWelcome to the VIP Betting Tips Bot! \uD83C\uDFAF\n\nHere's what you can do:\n- Get free daily betting tips\n- Upgrade to VIP for exclusive high-odds tips\n- Track your VIP status\n- Refer friends to earn free guides\n\n\uD83D\uDCA1 Tip: Type /help to see all available commands and how to use them!");
                return [4 /*yield*/, ctx.reply(message)];
            case 1:
                _c.sent();
                return [2 /*return*/];
        }
    });
}); });
bot.command('tips', function (ctx) { return __awaiter(void 0, void 0, void 0, function () {
    var realTips, tipsMessage;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, getFreeTips()];
            case 1:
                realTips = _a.sent();
                if (!(Array.isArray(realTips) && realTips.length > 0 && typeof realTips[0] === 'string' && realTips[0].startsWith('⚠️'))) return [3 /*break*/, 3];
                return [4 /*yield*/, ctx.reply(realTips[0])];
            case 2:
                _a.sent();
                return [2 /*return*/];
            case 3:
                tipsMessage = '📊 REAL UPCOMING MATCHES & ODDS\n\n' + realTips.join('\n\n') + '\n\n💡 Want premium VIP tips? Use /subscribe\n\n⚠️ These probabilities are *implied* from odds, not guaranteed outcomes.';
                return [4 /*yield*/, ctx.reply(tipsMessage)];
            case 4:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
bot.command('refer', function (ctx) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, users, user, botUsername, referralLink, message, pdfDownloadLink;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                userId = ctx.from.id;
                users = loadUsers();
                user = users.find(function (u) { return u.user_id === userId; });
                botUsername = 'OddsMaster_bot';
                referralLink = "https://t.me/".concat(botUsername, "?start=").concat(userId);
                message = "\uD83C\uDFAF Invite your friends to our VIP Betting Tips Bot!\n\n\uD83D\uDD17 Share your referral link:\n".concat(referralLink, "\n\n");
                if (user && (user.referrals || 0) > 0) {
                    pdfDownloadLink = 'https://s1.welib-public.org/s2/zlib2/pilimi-zlib2-22300000-22399999/22352133~/1763174096.0UBd9qXHf_cpN2Ja1XAOhg/Sports%20Betting%20to%20Win-%20The%2010%20keys%20to%20disciplined%20and%20--%20Steve,%20Ward%20--%20(WeLib.org).epub';
                    message += "\uD83D\uDCE5 Thank you for referring! Download your free betting guide here:\n".concat(pdfDownloadLink);
                }
                else {
                    message += '📥 Invite at least one friend to unlock your free betting guide!';
                }
                return [4 /*yield*/, ctx.reply(message)];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
bot.command('vip', function (ctx) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, vipList, vipMessage;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                userId = ctx.from.id;
                if (!!isVip(userId)) return [3 /*break*/, 2];
                return [4 /*yield*/, ctx.reply('⚠️ You need VIP membership to access premium tips!\n\nUse /subscribe to get VIP access.')];
            case 1:
                _a.sent();
                return [2 /*return*/];
            case 2: return [4 /*yield*/, getVipTips()];
            case 3:
                vipList = _a.sent();
                if (!(Array.isArray(vipList) && vipList.length > 0 && typeof vipList[0] === 'string' && vipList[0].startsWith('⚠️'))) return [3 /*break*/, 5];
                return [4 /*yield*/, ctx.reply(vipList[0])];
            case 4:
                _a.sent();
                return [2 /*return*/];
            case 5:
                vipMessage = '💎 PREMIUM VIP BETTING TIPS\n\n' + vipList.join('\n\n') + '\n\n⚠️ These probabilities are *implied* from odds, not guaranteed outcomes.';
                return [4 /*yield*/, ctx.reply(vipMessage)];
            case 6:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
// Scheduled job: Send daily tips to your account at 9 AM
cron.schedule('0 9 * * *', function () { return __awaiter(void 0, void 0, void 0, function () {
    var tips, message;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, getFreeTips()];
            case 1:
                tips = _a.sent();
                if (!(Array.isArray(tips) && tips.length > 0 && !tips[0].startsWith('⚠️'))) return [3 /*break*/, 3];
                message = '📊 Your Daily Free Betting Tips:\n\n' + tips.join('\n\n');
                return [4 /*yield*/, sendToUser(7417782185, message)];
            case 2:
                _a.sent();
                _a.label = 3;
            case 3: return [2 /*return*/];
        }
    });
}); });
// Launch bot
bot.launch();
logger.info('🚀 Bot starting...');
// Graceful shutdown
process.once('SIGINT', function () { return bot.stop('SIGINT'); });
process.once('SIGTERM', function () { return bot.stop('SIGTERM'); });
