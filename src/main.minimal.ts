import express from 'express';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (_req, res) => res.send('Bot placeholder is running.'));
app.get('/health', (_req, res) => res.json({ status: 'healthy' }));

app.listen(PORT, () => {
  console.log(`Express keep-alive server started on port ${PORT}`);
});

// Minimal config write to ensure filesystem is writable during build
const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  const defaultConfig = {
    BOT_TOKEN: process.env.BOT_TOKEN || 'MISSING_TOKEN',
    ADMIN_IDS: [],
  };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
    console.log('Wrote default config.json');
  } catch (e) {
    console.error('Failed to write config.json', e);
  }
}

export {};
