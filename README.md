# VIP Betting Tips Bot

A Telegram bot that provides betting tips and odds from various sports leagues.

## Features
- Free daily tips from Premier League
- VIP tips from Champions League
- Scheduled daily tips at 10:00 AM
- Payment verification system
- Referral program

## Deployment
This bot is deployed on Render.com and runs 24/7.

## Commands
- `/start` - Start the bot
- `/tips` - Get free betting tips
- `/vip` - Get VIP tips (requires subscription)
- `/subscribe` - Subscribe to VIP
- `/status` - Check your account status
```

3. **Save the file**

---

## Verify Your Folder Structure

After creating all files, your project should look like this:
```
betting-bot/
├── src/
│   └── main.ts
├── dist/ (created when you run npm run build)
├── node_modules/
├── logs/
├── .gitignore          ← NEW FILE
├── .dockerignore       ← NEW FILE
├── Dockerfile          ← NEW FILE
├── render.yaml         ← NEW FILE
├── package.json        ← UPDATED
├── package-lock.json
├── tsconfig.json
├── ecosystem.config.js
├── README.md           ← NEW FILE (optional)
├── config.json
└── users.json

