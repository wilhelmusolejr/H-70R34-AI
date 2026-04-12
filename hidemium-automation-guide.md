# Hidemium + Automation Guide

Control Hidemium browser profiles programmatically using its **local REST API**, then attach Playwright / Puppeteer / Selenium to drive them.

---

## 1. How it works

Hidemium runs a local API server on your machine (default `http://127.0.0.1:5555`) whenever the **Hidemium client app is open**. You call endpoints to open/close profiles, and Hidemium returns a Chrome DevTools Protocol (CDP) debugging port that any modern automation library can attach to.

```
Your script  ──HTTP──▶  Hidemium local API (127.0.0.1:5555)
                              │
                              ▼
                    Launches fingerprinted Chromium
                              │
                              ▼
        Returns { remote_port, profile_path, execute_path }
                              │
                              ▼
        Your script ──CDP──▶ that browser instance
```

The key insight: **Hidemium launches the browser, your script just connects to it.** This preserves all the fingerprint/proxy/cookie isolation Hidemium provides.

---

## 2. Core API endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/openProfile?uuid={uuid}` | Launch a profile, returns `remote_port` |
| `GET`  | `/closeProfile?uuid={uuid}` | Close a running profile |
| `POST` | `/profile` | Create a new profile |
| `GET`  | `/profiles` | List all profiles |

### Example response from `/openProfile`

```json
{
  "status": "successfully",
  "data": {
    "remote_port": 4000,
    "profile_path": "C:\\Users\\You\\AppData\\Local\\Temp\\.hidemium\\<uuid>",
    "execute_path": "C:\\Users\\You\\.hidemium\\browser\\mulbrowser\\115.0.0.0_v6\\chrome.exe"
  }
}
```

The `remote_port` is what you pass to your automation library.

---

## 3. Recommended stack: Playwright + Node.js

**Why Playwright over Puppeteer / Selenium:**

- Built by the original Puppeteer team (now at Microsoft)
- Auto-waiting eliminates flaky `sleep()` calls
- Built-in trace viewer + codegen for debugging
- First-class `connectOverCDP()` — perfect fit for Hidemium
- Cross-browser (Chromium, Firefox, WebKit) from one API
- Active development, unlike Puppeteer which has slowed
- Modern async/await ergonomics, cleaner than Selenium

### Setup

```bash
mkdir hidemium-automation && cd hidemium-automation
npm init -y
npm install playwright axios
```

---

## 4. Single profile example (Playwright)

```javascript
// single-profile.js
const { chromium } = require('playwright');
const axios = require('axios');

const HIDEMIUM_API = 'http://127.0.0.1:5555';
const PROFILE_UUID = 'your-profile-uuid-here';

async function run() {
  // 1. Tell Hidemium to open the profile
  const { data } = await axios.get(`${HIDEMIUM_API}/openProfile?uuid=${PROFILE_UUID}`);
  const port = data.data.remote_port;
  console.log(`Profile opened on port ${port}`);

  // 2. Attach Playwright via CDP
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  // 3. Drive the browser
  await page.goto('https://whatismybrowser.com');
  await page.waitForLoadState('networkidle');
  console.log('Title:', await page.title());

  // Take a screenshot to verify
  await page.screenshot({ path: 'result.png' });

  // 4. Disconnect (don't .close() — that kills Hidemium's browser)
  await browser.close();

  // 5. Close the profile via Hidemium API
  await axios.get(`${HIDEMIUM_API}/closeProfile?uuid=${PROFILE_UUID}`);
  console.log('Profile closed');
}

run().catch(console.error);
```

> **Important:** Use `browser.close()` from Playwright's perspective only disconnects the CDP session — Hidemium still owns the browser process. Always call `/closeProfile` to actually shut it down.

---

## 5. Multiple profiles in parallel

```javascript
// parallel-profiles.js
const { chromium } = require('playwright');
const axios = require('axios');

const HIDEMIUM_API = 'http://127.0.0.1:5555';
const PROFILE_UUIDS = [
  'uuid-1',
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
  // Run all profiles concurrently
  await Promise.all(PROFILE_UUIDS.map(runProfile));
  console.log('All profiles finished');
}

main();
```

For larger batches, throttle concurrency to avoid CPU/RAM overload:

```javascript
// Limit to 5 at a time
const pLimit = require('p-limit'); // npm install p-limit
const limit = pLimit(5);
await Promise.all(PROFILE_UUIDS.map(uuid => limit(() => runProfile(uuid))));
```

---

## 6. Reusable helper module

```javascript
// hidemium.js
const axios = require('axios');
const { chromium } = require('playwright');

const API = 'http://127.0.0.1:5555';

async function openProfile(uuid) {
  const { data } = await axios.get(`${API}/openProfile?uuid=${uuid}`);
  if (data.status !== 'successfully') {
    throw new Error(`Failed to open ${uuid}: ${JSON.stringify(data)}`);
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${data.data.remote_port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  return { browser, context, page, port: data.data.remote_port };
}

async function closeProfile(uuid, browser) {
  if (browser) await browser.close().catch(() => {});
  await axios.get(`${API}/closeProfile?uuid=${uuid}`).catch(() => {});
}

async function listProfiles() {
  const { data } = await axios.get(`${API}/profiles`);
  return data.data || [];
}

module.exports = { openProfile, closeProfile, listProfiles };
```

Usage:

```javascript
const { openProfile, closeProfile } = require('./hidemium');

(async () => {
  const uuid = 'your-uuid';
  const { browser, page } = await openProfile(uuid);
  try {
    await page.goto('https://google.com');
    // ... your automation ...
  } finally {
    await closeProfile(uuid, browser);
  }
})();
```

---

## 7. Common gotchas

- **Hidemium client must be running** — the API is local, no cloud fallback
- **Don't `.close()` the browser before calling `/closeProfile`** — leaves zombie processes eating RAM
- **One profile = one browser instance** — don't try to share contexts across profiles
- **Proxy errors:** check the proxy in Hidemium's UI before automating; broken proxies surface as `net::ERR_PROXY_CONNECTION_FAILED`
- **Concurrency limits:** each profile is a full Chromium process (~300–500 MB RAM). Plan accordingly
- **CDP version mismatch:** if Playwright complains about protocol versions, update Hidemium to match a recent Chromium
- **First page already exists:** Hidemium launches with a default page open, so use `context.pages()[0]` instead of always calling `newPage()`

---

## 8. Alternative: Python + Playwright

If you prefer Python:

```python
import requests
from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:5555"
UUID = "your-profile-uuid"

r = requests.get(f"{API}/openProfile?uuid={UUID}").json()
port = r["data"]["remote_port"]

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    page.goto("https://example.com")
    print(page.title())

    browser.close()

requests.get(f"{API}/closeProfile?uuid={UUID}")
```

---

## 9. Useful references

- Hidemium Docs: https://docs.hidemium.io/
- Playwright Docs: https://playwright.dev/
- Playwright `connectOverCDP`: https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- Hidemium Postman collection: https://www.postman.com/winter-crescent-199230/hidemium-public-api/collection/zq6z2rg/api-public

---

## 10. Quick decision matrix

| Need | Tool |
|------|------|
| Modern, fewest gotchas, best DX | **Playwright** ✅ |
| Existing Puppeteer codebase | Puppeteer (still works fine) |
| Legacy QA / Java / cross-language teams | Selenium |
| No-code, simple flows | Hidemium's built-in Prompt Script |
