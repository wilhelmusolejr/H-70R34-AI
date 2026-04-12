// parallel-profiles.js
const { chromium } = require('playwright');
const axios = require('axios');
const pLimit = require('p-limit');

const HIDEMIUM_API = 'http://127.0.0.1:5555';
const PROFILE_UUIDS = [
  'uuid-1', // <-- replace with your profile UUIDs
  'uuid-2',
  'uuid-3',
];

async function runProfile(uuid) {
  try {
    const { data } = await axios.get(`${HIDEMIUM_API}/openProfile?uuid=${uuid}`);
    const port = data.data.remote_port;

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();

    // === Your per-profile script ===
    await page.goto('https://example.com');
    await page.waitForLoadState('networkidle');
    console.log(`[${uuid}] ${await page.title()}`);
    // ===============================

    await browser.close();
  } catch (err) {
    console.error(`[${uuid}] Error:`, err.message);
  } finally {
    await axios.get(`${HIDEMIUM_API}/closeProfile?uuid=${uuid}`).catch(() => {});
  }
}

async function main() {
  // Limit to 5 concurrent profiles to avoid CPU/RAM overload
  const limit = pLimit(5);
  await Promise.all(PROFILE_UUIDS.map(uuid => limit(() => runProfile(uuid))));
  console.log('All profiles finished');
}

main();
