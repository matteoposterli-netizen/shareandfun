// Apre 4 finestre Chromium isolate (profili separati) e fa auto-login su spiaggiamia.com.
//
// Setup (una tantum):
//   cd scripts && npm init -y && npm install playwright && npx playwright install chromium
//
// Uso:
//   1. cp scripts/credentials.example.json scripts/credentials.json
//   2. Modifica credentials.json con le 4 coppie email/password
//   3. node scripts/login-4accounts.js
//   Ctrl+C per chiudere tutte le finestre.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = process.env.SPIAGGIAMIA_URL || 'https://spiaggiamia.com';
const CREDS_PATH = path.join(__dirname, 'credentials.json');
const PROFILES_DIR = path.join(__dirname, '.chrome-profiles');

async function loginOne(index, { email, password }) {
  const userDataDir = path.join(PROFILES_DIR, `account-${index + 1}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    args: [
      `--window-size=1100,800`,
      `--window-position=${(index % 2) * 1120},${Math.floor(index / 2) * 820}`,
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  const url = `${BASE_URL}/?login=${encodeURIComponent(email)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  await page.waitForSelector('#login-password', { timeout: 15000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#btn-login');

  console.log(`[${index + 1}] login inviato per ${email}`);
  return context;
}

async function main() {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error(`File mancante: ${CREDS_PATH}`);
    console.error(`Copialo da credentials.example.json e compila le 4 coppie.`);
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  if (!Array.isArray(creds) || creds.length === 0) {
    console.error('credentials.json deve essere un array non vuoto di {email,password}.');
    process.exit(1);
  }

  const contexts = [];
  for (let i = 0; i < creds.length; i++) {
    try {
      contexts.push(await loginOne(i, creds[i]));
    } catch (err) {
      console.error(`[${i + 1}] errore:`, err.message);
    }
  }

  console.log(`\n${contexts.length} finestre aperte. Ctrl+C per chiudere tutto.`);
  process.on('SIGINT', async () => {
    console.log('\nChiusura finestre...');
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    process.exit(0);
  });
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
