/**
 * Example: Connect Playwright to a running Antidetect profile via Local REST API.
 * Usage:
 *   API_KEY=ad_xxx PROFILE_ID=<uuid> node examples/playwright-connect.mjs
 */
import { chromium } from 'playwright-core';

const BASE_URL = process.env.API_URL || 'http://127.0.0.1:36912';
const API_KEY = process.env.API_KEY;
const PROFILE_ID = process.env.PROFILE_ID;

if (!API_KEY || !PROFILE_ID) {
  console.error('Missing API_KEY or PROFILE_ID environment variables.');
  process.exit(1);
}

const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

const startRes = await fetch(`${BASE_URL}/profiles/${PROFILE_ID}/start`, {
  method: 'POST',
  headers,
});
if (!startRes.ok) {
  throw new Error(`Failed to start profile: ${await startRes.text()}`);
}

const { wsEndpoint } = await startRes.json();
console.log('Connected CDP wsEndpoint:', wsEndpoint);

const browser = await chromium.connectOverCDP(wsEndpoint);
const context = browser.contexts()[0] ?? (await browser.newContext());
const page = context.pages()[0] ?? (await context.newPage());

await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await page.screenshot({ path: 'example-screenshot.png' });
console.log('Saved example-screenshot.png');

await fetch(`${BASE_URL}/profiles/${PROFILE_ID}/stop`, { method: 'POST', headers });
console.log('Profile stopped.');
