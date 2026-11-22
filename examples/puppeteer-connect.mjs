/**
 * Example: Connect Puppeteer to a running Antidetect profile via Local REST API.
 * Usage:
 *   API_KEY=ad_xxx PROFILE_ID=<uuid> node examples/puppeteer-connect.mjs
 * (Requires: npm install puppeteer-core)
 */
const BASE_URL = process.env.API_URL || 'http://127.0.0.1:36912';
const API_KEY = process.env.API_KEY;
const PROFILE_ID = process.env.PROFILE_ID;

if (!API_KEY || !PROFILE_ID) {
  console.error('Missing API_KEY or PROFILE_ID environment variables.');
  process.exit(1);
}

const { default: puppeteer } = await import('puppeteer-core');
const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

const startRes = await fetch(`${BASE_URL}/profiles/${PROFILE_ID}/start`, {
  method: 'POST',
  headers,
});
const { wsEndpoint } = await startRes.json();

const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const page = await browser.newPage();
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: 'puppeteer-screenshot.png' });
console.log('Saved puppeteer-screenshot.png');

await fetch(`${BASE_URL}/profiles/${PROFILE_ID}/stop`, { method: 'POST', headers });
