// Apre N finestre Chromium in vera incognito (nessuna persistenza su disco,
// ogni contesto è isolato dagli altri) e fa auto-login su spiaggiamia.com.
//
// Setup (una tantum):
//   cd scripts && npm init -y && npm install playwright && npx playwright install chromium
//
// Uso:
//   1. cp scripts/credentials.example.json scripts/credentials.json
//   2. Modifica credentials.json con le 4 coppie email/password
//   3. node scripts/login-4accounts.js
//   Ctrl+C per chiudere tutte le finestre (e scartare cookie/sessione).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.SPIAGGIAMIA_URL || 'https://spiaggiamia.com';
const CREDS_PATH = path.join(__dirname, 'credentials.json');

const WIN_W = 1100;
const WIN_H = 800;

async function loginOne(browser, index, { email, password }) {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  const x = (index % 2) * (WIN_W + 20);
  const y = Math.floor(index / 2) * (WIN_H + 40);
  await page.evaluate(
    ([w, h, px, py]) => {
      window.resizeTo(w, h);
      window.moveTo(px, py);
    },
    [WIN_W, WIN_H, x, y],
  );

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
    console.error(`Copialo da credentials.example.json e compila le coppie.`);
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  if (!Array.isArray(creds) || creds.length === 0) {
    console.error('credentials.json deve essere un array non vuoto di {email,password}.');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
    args: [`--window-size=${WIN_W},${WIN_H}`],
  });

  const contexts = [];
  for (let i = 0; i < creds.length; i++) {
    try {
      contexts.push(await loginOne(browser, i, creds[i]));
    } catch (err) {
      console.error(`[${i + 1}] errore:`, err.message);
    }
  }

  console.log(`\n${contexts.length} finestre aperte (incognito effimera). Ctrl+C per chiudere.`);
  const shutdown = async () => {
    console.log('\nChiusura finestre...');
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
