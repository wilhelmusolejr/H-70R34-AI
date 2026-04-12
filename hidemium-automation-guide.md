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

| Method | Endpoint                    | Purpose                                 |
| ------ | --------------------------- | --------------------------------------- |
| `GET`  | `/openProfile?uuid={uuid}`  | Launch a profile, returns `remote_port` |
| `GET`  | `/closeProfile?uuid={uuid}` | Close a running profile                 |
| `POST` | `/profile`                  | Create a new profile                    |
| `GET`  | `/profiles`                 | List all profiles                       |

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
const { chromium } = require("playwright");
const axios = require("axios");

const HIDEMIUM_API = "http://127.0.0.1:5555";
const PROFILE_UUID = "your-profile-uuid-here";

async function run() {
  // 1. Tell Hidemium to open the profile
  const { data } = await axios.get(
    `${HIDEMIUM_API}/openProfile?uuid=${PROFILE_UUID}`,
  );
  const port = data.data.remote_port;
  console.log(`Profile opened on port ${port}`);

  // 2. Attach Playwright via CDP
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());

  // 3. Drive the browser
  await page.goto("https://whatismybrowser.com");
  await page.waitForLoadState("networkidle");
  console.log("Title:", await page.title());

  // Take a screenshot to verify
  await page.screenshot({ path: "result.png" });

  // 4. Disconnect (don't .close() — that kills Hidemium's browser)
  await browser.close();

  // 5. Close the profile via Hidemium API
  await axios.get(`${HIDEMIUM_API}/closeProfile?uuid=${PROFILE_UUID}`);
  console.log("Profile closed");
}

run().catch(console.error);
```

> **Important:** Use `browser.close()` from Playwright's perspective only disconnects the CDP session — Hidemium still owns the browser process. Always call `/closeProfile` to actually shut it down.

---

## 5. Multiple profiles in parallel

```javascript
// parallel-profiles.js
const { chromium } = require("playwright");
const axios = require("axios");

const HIDEMIUM_API = "http://127.0.0.1:5555";
const PROFILE_UUIDS = ["uuid-1", "uuid-2", "uuid-3"];

async function runProfile(uuid) {
  try {
    const { data } = await axios.get(
      `${HIDEMIUM_API}/openProfile?uuid=${uuid}`,
    );
    const port = data.data.remote_port;

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || (await context.newPage());

    // === Your per-profile script ===
    await page.goto("https://example.com");
    await page.waitForLoadState("networkidle");
    console.log(`[${uuid}] ${await page.title()}`);
    // ===============================

    await browser.close();
  } catch (err) {
    console.error(`[${uuid}] Error:`, err.message);
  } finally {
    await axios
      .get(`${HIDEMIUM_API}/closeProfile?uuid=${uuid}`)
      .catch(() => {});
  }
}

async function main() {
  // Run all profiles concurrently
  await Promise.all(PROFILE_UUIDS.map(runProfile));
  console.log("All profiles finished");
}

main();
```

For larger batches, throttle concurrency to avoid CPU/RAM overload:

```javascript
// Limit to 5 at a time
const pLimit = require("p-limit"); // npm install p-limit
const limit = pLimit(5);
await Promise.all(PROFILE_UUIDS.map((uuid) => limit(() => runProfile(uuid))));
```

---

## 6. Reusable helper module

```javascript
// hidemium.js
const axios = require("axios");
const { chromium } = require("playwright");

const API = "http://127.0.0.1:5555";

async function openProfile(uuid) {
  const { data } = await axios.get(`${API}/openProfile?uuid=${uuid}`);
  if (data.status !== "successfully") {
    throw new Error(`Failed to open ${uuid}: ${JSON.stringify(data)}`);
  }
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${data.data.remote_port}`,
  );
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
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
const { openProfile, closeProfile } = require("./hidemium");

(async () => {
  const uuid = "your-uuid";
  const { browser, page } = await openProfile(uuid);
  try {
    await page.goto("https://google.com");
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

| Need                                    | Tool                              |
| --------------------------------------- | --------------------------------- |
| Modern, fewest gotchas, best DX         | **Playwright** ✅                 |
| Existing Puppeteer codebase             | Puppeteer (still works fine)      |
| Legacy QA / Java / cross-language teams | Selenium                          |
| No-code, simple flows                   | Hidemium's built-in Prompt Script |

---

# Part 2: Battle-Tested Patterns for Facebook Automation

The following patterns were developed through real-world testing against Facebook's React-based UI. They solve problems that break naive automation approaches. **Any agent modifying this codebase must understand these patterns first.**

---

## 11. The Virtualized DOM Problem

**This is the single most important concept.** Facebook uses React virtualization — it only renders DOM elements that are near the current viewport. Everything else is destroyed.

### What this means in practice

If you scroll down a feed for 30 seconds, then call `document.querySelectorAll('div[aria-label="Like"]')`, you will only get **2–3 elements** — the ones currently visible on screen. All the Like buttons you scrolled past no longer exist in the DOM.

### What breaks

```javascript
// ❌ BROKEN — only finds 2-3 elements after scrolling
await scrollForDuration(page, 30000);
const total = await page.locator('div[aria-label="Like"]').count(); // returns 2-3

// ❌ BROKEN — element #8 no longer exists when you try to click it
await page.locator('div[aria-label="Like"]').nth(8).click(); // TimeoutError
```

### What works: Two-Pass Collection

**Pass 1 (Collection):** Scroll through the entire page in viewport-sized steps. At each stop, query the DOM and record the `pageY` (absolute page position) of every target element. Deduplicate by rounding positions to 50px buckets.

**Pass 2 (Interaction):** For each recorded position, scroll there with mouse wheel, find the freshly-rendered element closest to viewport center, and interact with it.

```javascript
// ✅ CORRECT — collect positions while scrolling
async function collectLikePositions(page) {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);

  const allTargets = [];
  const seenPositions = new Set();

  for (let y = 0; y < scrollHeight; y += Math.floor(viewportHeight * 0.7)) {
    await humanScrollTo(page, y + viewportHeight / 2);
    await page.waitForTimeout(randomInt(300, 600));

    const visible = await page.evaluate(
      ({ selector }) => {
        return Array.from(document.querySelectorAll(selector)).map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            pageY: Math.round(window.scrollY + rect.y),
            x: rect.x,
            width: rect.width,
            height: rect.height,
          };
        });
      },
      { selector: LIKE_SELECTOR },
    );

    for (const v of visible) {
      // dedupe: round to 50px bucket
      const key = Math.round(v.pageY / 50) * 50;
      if (!seenPositions.has(key)) {
        seenPositions.add(key);
        allTargets.push(v);
      }
    }
  }

  return allTargets; // typically 30-50 elements instead of 2-3
}
```

### Why data-attribute tagging doesn't work

You might think: "tag each element with a `data-*` attribute so I can find it later." This fails because React **destroys and recreates** the DOM nodes entirely when they leave the viewport. Your attributes are deleted along with the nodes.

---

## 12. Never Use `scrollIntoView` — Use Mouse Wheel

`element.scrollIntoView()` is a programmatic API that no real user can trigger. A human scrolls with their mouse wheel or trackpad. Anti-detection systems can distinguish between the two.

### ❌ BAD — `scrollIntoView`

```javascript
await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Like"]');
  el.scrollIntoView({ block: "center", behavior: "auto" }); // bot-like
});
```

### ✅ GOOD — `humanScrollTo` with mouse wheel

```javascript
async function humanScrollTo(page, targetPageY) {
  const viewport = await page.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
  }));

  // center the target in the viewport
  const desiredScrollY = Math.max(0, targetPageY - viewport.innerHeight / 2);
  let distance = desiredScrollY - viewport.scrollY;

  if (Math.abs(distance) < 10) return; // already there

  const direction = distance > 0 ? 1 : -1; // +1 = down, -1 = up
  let remaining = Math.abs(distance);

  while (remaining > 0) {
    const chunk = Math.min(remaining, randomInt(220, 500));
    let stepped = 0;

    while (stepped < chunk) {
      const step = Math.min(chunk - stepped, randomInt(18, 40));
      await page.mouse.wheel(0, step * direction);
      stepped += step;
      await page.waitForTimeout(randomInt(16, 40));
    }

    remaining -= chunk;
    if (remaining > 0) {
      await page.waitForTimeout(randomInt(100, 260));
    }
  }

  await page.waitForTimeout(randomInt(200, 400));
}
```

### Critical: Must handle negative values

`page.mouse.wheel(0, -30)` scrolls up. If your scroll utility only handles positive values, scrolling back to the top of the page (or to any element above current position) will silently fail. **Always multiply by direction.**

---

## 13. Never Use Locator `.nth()` for Clicking — Use Bounding Box

Playwright's `.nth(index)` re-queries the DOM to find the Nth matching element. On virtualized pages, the element count changes constantly as you scroll. Element #8 during collection may no longer be element #8 (or may not exist at all) when you try to click.

### ❌ BAD — locator re-query

```javascript
// Collected index 8 earlier, but DOM has changed since then
await page.locator('div[aria-label="Like"]').nth(8).click(); // TimeoutError after 5000ms
```

### ✅ GOOD — bounding box from `page.evaluate`, then `page.mouse.click`

```javascript
// Get box inside the same evaluate that confirms the element exists
const info = await page.evaluate(
  ({ selector }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  },
  { selector: LIKE_SELECTOR },
);

if (info) {
  const cx = info.x + info.width / 2;
  const cy = info.y + info.height / 2;
  await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
}
```

### Why `page.mouse.click(x, y)` is also better for anti-detection

`mouse.click` dispatches real pointer events at specific viewport coordinates — exactly what a human click looks like. Locator `.click()` uses internal Playwright protocols that may not generate identical event chains.

The `delay` option adds randomized time between mousedown and mouseup (40–120ms), simulating a real finger press.

---

## 14. Viewport-Center Proximity Matching

After scrolling to a recorded `pageY`, you need to find the target element that's now rendered in the viewport. Since React re-created the DOM, you can't use tracking attributes or indices. Instead, find the element **closest to the vertical center of the viewport**.

This works because `humanScrollTo` aims to center the target. The closest matching element to `innerHeight / 2` is almost certainly the right one.

```javascript
const box = await page.evaluate(
  ({ selector }) => {
    const els = Array.from(document.querySelectorAll(selector));
    const vcenter = window.innerHeight / 2;
    let best = null;
    let bestDist = Infinity;

    for (const el of els) {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.y + rect.height / 2 - vcenter);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }

    return best;
  },
  { selector: LIKE_SELECTOR },
);
```

---

## 15. Human-Like Scrolling for Feed Browsing

For the initial "browse the feed" phase, use chunked scrolling with randomized parameters to simulate real reading behavior.

```javascript
async function smoothScrollBy(page, distance) {
  let remaining = Math.abs(distance);
  const direction = distance > 0 ? 1 : -1;

  while (remaining > 0) {
    const step = Math.min(remaining, randomInt(18, 40));
    await page.mouse.wheel(0, step * direction);
    remaining -= step;
    await page.waitForTimeout(randomInt(16, 40)); // ~60fps feel
  }
}

async function scrollForDuration(page, durationMs) {
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    // each "chunk" = one scroll gesture
    const chunkDistance = randomInt(220, 600);
    await smoothScrollBy(page, chunkDistance);

    const remainingMs = endTime - Date.now();
    if (remainingMs <= 0) break;

    // pause between gestures (like reading a post)
    await page.waitForTimeout(Math.min(remainingMs, randomInt(100, 260)));
  }
}
```

### Parameter ranges and why they matter

| Parameter   | Range     | Rationale                                                           |
| ----------- | --------- | ------------------------------------------------------------------- |
| Step size   | 18–40px   | Mimics individual scroll wheel notches or trackpad micro-gestures   |
| Step delay  | 16–40ms   | Aligns with ~60fps screen refresh; too fast = bot, too slow = laggy |
| Chunk size  | 220–600px | One "flick" of the wheel; roughly half to full viewport             |
| Chunk pause | 100–260ms | Brief pause between scroll gestures, like a finger lifting          |
| Duration    | 10–40s    | Total browsing time before interaction begins                       |

---

## 16. Clicking Buttons by `aria-label`

Facebook uses obfuscated class names (`x1i10hfl xjqpnuy xc5r6h4...`) that change with every deployment. **Never target class names.** Use `aria-label` attributes which are stable accessibility labels.

### Finding buttons

```javascript
// Like button
const LIKE_SELECTOR = 'div[aria-label="Like"]';

// Share button
const SHARE_SELECTOR =
  '[aria-label="Send this to friends or post it on your profile."]';

// Add Friend — note: includes dynamic name, so use partial match
// aria-label="Add Friend John Smith"
const candidates = document.querySelectorAll(
  'button, div[role="button"], a[role="button"]',
);
for (const el of candidates) {
  const aria = (el.getAttribute("aria-label") || "").trim();
  if (aria.toLowerCase().includes("add friend")) {
    // found it
  }
}
```

### Pattern for profile-page buttons (Add Friend, etc.)

These buttons are near the top of the page. After a precheck scroll, you must scroll back to the top first:

```javascript
// 1. Browse the profile page (human-like)
await scrollForDuration(page, randomInt(10000, 20000));

// 2. Scroll back to top
await humanScrollTo(page, 0);

// 3. Find button position
const info = await findButtonPosition(page); // returns { pageY, ... }

// 4. Scroll to it
await humanScrollTo(page, info.pageY);

// 5. Get fresh bounding box
const box = await getButtonBox(page);

// 6. Click
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
```

---

## 17. Modal Interaction (Share Dialog, etc.)

When clicking a button opens a modal, you need to wait for the dialog, interact with it, and confirm.

### Pattern for Share dialog

```javascript
async function sharePost(page, targetPageY) {
  // 1. Click the share button (using bounding-box pattern from §13)
  await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });

  // 2. Wait for modal
  try {
    await page.waitForSelector('div[role="dialog"]', { timeout: 5000 });
  } catch {
    console.log("Modal did not appear");
    return false;
  }
  await page.waitForTimeout(randomInt(800, 1500)); // let it fully render

  // 3. Type in the textbox (human-like)
  const TEXTBOX =
    'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
  await page.waitForSelector(TEXTBOX, { timeout: 3000 });
  await humanType(page, TEXTBOX, "your message here");

  // 4. Click confirm button
  const CONFIRM = '[aria-label="Share now"]';
  const box = await page.evaluate(
    ({ sel }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    { sel: CONFIRM },
  );

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // 5. Wait for modal to close
  await page.waitForTimeout(randomInt(1500, 3000));
}
```

### Key modal selectors on Facebook

| Element          | Selector                                                         |
| ---------------- | ---------------------------------------------------------------- |
| Any modal dialog | `div[role="dialog"]`                                             |
| Close button (X) | `div[role="dialog"] [aria-label="Close"]`                        |
| Share textbox    | `div[role="dialog"] div[contenteditable="true"][role="textbox"]` |
| Share now button | `[aria-label="Share now"]`                                       |

---

## 18. Human-Like Typing

Never use `page.fill()` or `page.type()` with the full string — those are instant or uniform-speed. Real humans type character by character with variable delays.

```javascript
async function humanType(page, selector, text) {
  // Click to focus the input
  await page.click(selector);
  await page.waitForTimeout(randomInt(300, 600));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(50, 180) });

    // Extra pause after spaces (thinking between words)
    if (char === " ") {
      await page.waitForTimeout(randomInt(80, 250));
    }
  }
}
```

### Why not `page.fill()`

`page.fill()` sets the value instantly — no keydown/keyup events, no input events fired in sequence. React controlled components may not register it at all, and it's trivially detectable as non-human.

---

## 19. Complete Interaction Flow Summary

Here's the full pattern for a feed interaction script:

```
1. Wait for page load
      ↓
2. Initial browse scroll (10-40s, human-like, down only)
      ↓
3. Scroll back to top via humanScrollTo(page, 0)
      ↓
4. Collection pass: scroll top→bottom in 70% viewport steps
   At each stop: querySelectorAll → record pageY → dedupe by 50px bucket
      ↓
5. Shuffle collected targets → pick random half
      ↓
6. Optionally pick 1 target for sharing
      ↓
7. Click pass: for each target:
   a. humanScrollTo(page, target.pageY)
   b. page.evaluate → find element closest to viewport center → get bounding box
   c. page.mouse.click(center_x, center_y, { delay: random })
   d. If this is the share target: trigger sharePost()
   e. Wait 10-20s before next click
```

---

## 20. Anti-Pattern Reference

Things that **will break** or **will be detected**. Do not use these.

| ❌ Anti-pattern                                | ✅ Correct approach                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `element.scrollIntoView()`                     | `page.mouse.wheel()` in small steps                                   |
| `page.locator(sel).nth(N).click()`             | `page.evaluate` → get box → `page.mouse.click(x, y)`                  |
| `page.fill(selector, text)`                    | `humanType()` — character by character with random delays             |
| `querySelectorAll` after long scroll           | Two-pass: collect during scroll, click in second pass                 |
| Targeting CSS class names                      | Use `aria-label` attributes (stable across deployments)               |
| `data-*` attribute tagging for later retrieval | Record `pageY` positions + viewport-center proximity matching         |
| Fixed delays (`sleep(2000)`)                   | Randomized ranges (`randomInt(1000, 3000)`)                           |
| `window.scrollTo({ top: 0 })`                  | `humanScrollTo(page, 0)` via mouse wheel                              |
| Instant page navigation during interaction     | Scroll to target first, then interact                                 |
| Single `evaluate` for find + scroll + click    | Separate: scroll first (mouse.wheel) → evaluate for box → mouse.click |

---

## 21. File Structure

Recommended project layout:

```
hidemium-autopilot/
├── hidemium.js                          # Reusable Hidemium API helper (§6)
├── single-profile.js                    # Entry point: opens profile, runs steps
├── utils/
│   └── scroll-utils.js                  # randomInt, smoothScrollBy, scrollForDuration
├── steps/
│   ├── facebook-homepage-interaction.js # Feed: like + share posts
│   ├── profile-interaction.js           # Profile page: like posts
│   └── adding-friend-step.js            # Profile page: add friend
└── hidemium-automation-guide.md         # This file
```

Each step module exports a single `async function(page)` that receives a Playwright page and performs its actions. The entry point (`single-profile.js`) opens the Hidemium profile, picks the step to run, and passes the page.
