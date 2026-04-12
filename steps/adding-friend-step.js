// adding-friend-step.js
const { randomInt, scrollForDuration } = require("./utils/scroll-utils");
const { ensureUrl } = require("./utils/navigation");
const { getRandomProfileUrl } = require("../data/profile-urls");

const PRECHECK_SCROLL_MIN_MS = 10000;
const PRECHECK_SCROLL_MAX_MS = 20000;

// ---------- find element position on the page (no scrollIntoView) ----------

async function findAddFriendPosition(page) {
  return page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('button, div[role="button"], a[role="button"]'),
    );

    for (const el of candidates) {
      const aria = (el.getAttribute("aria-label") || "").trim();
      if (!aria.toLowerCase().includes("add friend")) continue;

      const rect = el.getBoundingClientRect();
      return {
        found: true,
        text: (el.textContent || "").trim(),
        ariaLabel: aria,
        className: typeof el.className === "string" ? el.className : "",
        // absolute page-Y so we know where to scroll to
        pageY: window.scrollY + rect.y,
        height: rect.height,
      };
    }

    return { found: false };
  });
}

// ---------- get fresh viewport box after scrolling ----------

async function getAddFriendBox(page) {
  return page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('button, div[role="button"], a[role="button"]'),
    );

    for (const el of candidates) {
      const aria = (el.getAttribute("aria-label") || "").trim();
      if (!aria.toLowerCase().includes("add friend")) continue;

      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }

    return null;
  });
}

// ---------- human scroll to a page-Y coordinate (handles up + down) ----------

async function humanScrollTo(page, targetPageY) {
  const viewport = await page.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
  }));

  // aim to center the target in the viewport
  const desiredScrollY = Math.max(0, targetPageY - viewport.innerHeight / 2);
  let distance = desiredScrollY - viewport.scrollY;

  if (Math.abs(distance) < 10) return; // already there

  const direction = distance > 0 ? 1 : -1;
  let remaining = Math.abs(distance);

  while (remaining > 0) {
    // pick a chunk size
    const chunk = Math.min(remaining, randomInt(220, 500));

    // break chunk into small wheel steps (like a real finger on a trackpad)
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

  // let the page settle after scrolling
  await page.waitForTimeout(randomInt(200, 400));
}

// ---------- main routine ----------

async function runAddingFriendStep(page, data) {
  const targetUrl =
    (data && data.url) ||
    process.env.FACEBOOK_PROFILE_URL ||
    getRandomProfileUrl();
  console.log(`[adding_friend] Target profile: ${targetUrl}`);
  await ensureUrl(page, targetUrl);

  // human-like browse before interacting
  const precheckMs = randomInt(PRECHECK_SCROLL_MIN_MS, PRECHECK_SCROLL_MAX_MS);
  console.log(
    `[adding_friend] Precheck scroll: ${(precheckMs / 1000).toFixed(1)}s`,
  );
  await scrollForDuration(page, precheckMs);

  // scroll back up to where the Add Friend button lives (near header)
  const beforeScroll = await page.evaluate(() => window.scrollY);
  console.log(
    `[adding_friend] Current scrollY: ${beforeScroll}, scrolling to top...`,
  );
  await humanScrollTo(page, 0);
  const afterScroll = await page.evaluate(() => window.scrollY);
  console.log(`[adding_friend] After scroll-up, scrollY: ${afterScroll}`);
  await page.waitForTimeout(randomInt(600, 1200));

  // find the button's absolute position
  const info = await findAddFriendPosition(page);
  if (!info.found) {
    console.log("[adding_friend] Add Friend button not found.");
    return;
  }
  console.log(
    `[adding_friend] Found button at pageY: ${info.pageY}, aria: "${info.ariaLabel}"`,
  );

  // scroll to it with mouse wheel
  await humanScrollTo(page, info.pageY);
  await page.waitForTimeout(randomInt(300, 700));

  // get fresh viewport coordinates after scrolling
  const box = await getAddFriendBox(page);
  if (!box) {
    console.log("[adding_friend] Add Friend button lost after scroll.");
    return;
  }
  console.log(
    `[adding_friend] Box: x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} w=${box.width.toFixed(0)} h=${box.height.toFixed(0)}`,
  );

  try {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
    console.log(
      `[adding_friend] Clicked — aria-label="${info.ariaLabel}" text="${info.text}"`,
    );
  } catch (err) {
    console.log(`[adding_friend] Click failed: ${err.message}`);
  }
}

module.exports = runAddingFriendStep;
