// facebook-homepage-interaction.js
const { randomInt, scrollForDuration, shuffle, sleep, humanScrollTo } = require("./utils/scroll-utils");
const { ensureUrl } = require("./utils/navigation");

const LIKE_SELECTOR = 'div[aria-label="Like"]';
const SHARE_BUTTON_SELECTOR =
  '[aria-label="Send this to friends or post it on your profile."]';
const SHARE_NOW_SELECTOR = '[aria-label="Share now"]';
const SHARE_TEXTBOX_SELECTOR =
  'div[role="dialog"] div[contenteditable="true"][role="textbox"]';
const SHARE_MESSAGE = "lovely post! :)";
const SCROLL_DURATION_MIN_MS = 10000;
const SCROLL_DURATION_MAX_MS = 20000;
const LOG_INTERVAL_MIN_MS = 10000;
const LOG_INTERVAL_MAX_MS = 20000;

// ---------- collection pass: scroll through and record Like positions ----------

async function collectLikePositions(page) {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);

  const allTargets = [];
  const seenPositions = new Set();

  // scroll from top to bottom in overlapping steps
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
      const key = Math.round(v.pageY / 50) * 50;
      if (!seenPositions.has(key)) {
        seenPositions.add(key);
        allTargets.push(v);
      }
    }
  }

  return allTargets;
}

// ---------- human-like typing ----------

async function humanType(page, selector, text) {
  await page.click(selector);
  await page.waitForTimeout(randomInt(300, 600));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(50, 180) });
    // occasional micro-pause between words
    if (char === " ") {
      await page.waitForTimeout(randomInt(80, 250));
    }
  }
}

// ---------- share a post ----------

async function sharePost(page, targetPageY) {
  // scroll to the post
  await humanScrollTo(page, targetPageY);
  await page.waitForTimeout(randomInt(400, 800));

  // find the Share button closest to viewport center
  const shareBox = await page.evaluate(
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
          best = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        }
      }

      return best;
    },
    { selector: SHARE_BUTTON_SELECTOR },
  );

  if (!shareBox) {
    console.log(`[fb-interact] Share button not found at pageY≈${targetPageY}`);
    return false;
  }

  // click the share button
  const cx = shareBox.x + shareBox.width / 2;
  const cy = shareBox.y + shareBox.height / 2;
  await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
  console.log(`[fb-interact] Clicked Share button at pageY≈${targetPageY}`);

  // wait for the modal dialog to appear
  try {
    await page.waitForSelector('div[role="dialog"]', { timeout: 5000 });
  } catch {
    console.log("[fb-interact] Share modal did not appear.");
    return false;
  }
  await page.waitForTimeout(randomInt(800, 1500));

  // type the message in the textbox
  try {
    await page.waitForSelector(SHARE_TEXTBOX_SELECTOR, { timeout: 3000 });
    await humanType(page, SHARE_TEXTBOX_SELECTOR, SHARE_MESSAGE);
    console.log(`[fb-interact] Typed share message: "${SHARE_MESSAGE}"`);
  } catch {
    console.log("[fb-interact] Share textbox not found in modal.");
    return false;
  }

  await page.waitForTimeout(randomInt(500, 1000));

  // click "Share now"
  const shareNowBox = await page.evaluate(
    ({ selector }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    { selector: SHARE_NOW_SELECTOR },
  );

  if (!shareNowBox) {
    console.log("[fb-interact] Share now button not found.");
    return false;
  }

  const snCx = shareNowBox.x + shareNowBox.width / 2;
  const snCy = shareNowBox.y + shareNowBox.height / 2;
  await page.mouse.click(snCx, snCy, { delay: randomInt(40, 120) });
  console.log("[fb-interact] Clicked Share now.");

  // wait for modal to close
  await page.waitForTimeout(randomInt(1500, 3000));
  return true;
}

// ---------- main routine ----------

async function runFacebookHomepageInteraction(page) {
  await ensureUrl(page, "https://www.facebook.com/", { matchOriginOnly: true });

  // initial human-like browsing scroll
  const scrollMs = randomInt(SCROLL_DURATION_MIN_MS, SCROLL_DURATION_MAX_MS);
  console.log(`[fb-interact] Initial browse: ${(scrollMs / 1000).toFixed(1)}s`);
  await scrollForDuration(page, scrollMs);

  // scroll back to top before collection pass
  console.log("[fb-interact] Scrolling to top for collection pass...");
  await humanScrollTo(page, 0);
  await page.waitForTimeout(randomInt(500, 1000));

  // pass 1: scroll through and record all Like button positions
  const allTargets = await collectLikePositions(page);
  console.log(
    `[fb-interact] Collected ${allTargets.length} unique Like targets.`,
  );

  if (allTargets.length === 0) {
    console.log("[fb-interact] No Like elements found. Skipping.");
    return;
  }

  // select random half
  const shuffled = shuffle([...allTargets]);
  const selected = shuffled.slice(
    0,
    Math.max(1, Math.floor(allTargets.length / 2)),
  );
  console.log(`[fb-interact] Clicking ${selected.length} random targets.`);

  // pick 1 random target from the selected half to share
  const shareTargetIndex = randomInt(0, selected.length - 1);
  console.log(
    `[fb-interact] Will share post at index ${shareTargetIndex} (pageY≈${selected[shareTargetIndex].pageY})`,
  );

  // pass 2: scroll to each target and click
  for (let i = 0; i < selected.length; i += 1) {
    const target = selected[i];

    await humanScrollTo(page, target.pageY);
    await page.waitForTimeout(randomInt(250, 600));

    // find the Like button closest to viewport center (freshly rendered)
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
            best = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          }
        }

        return best;
      },
      { selector: LIKE_SELECTOR },
    );

    if (!box) {
      console.log(
        `[fb-interact] Target at pageY≈${target.pageY} not found after scroll.`,
      );
      continue;
    }

    try {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
      console.log(`[fb-interact] Clicked Like at pageY≈${target.pageY}`);
    } catch (err) {
      console.log(
        `[fb-interact] Click failed at pageY≈${target.pageY}: ${err.message}`,
      );
    }

    // share this post if it's the chosen one
    if (i === shareTargetIndex) {
      await page.waitForTimeout(randomInt(1000, 2000));
      await sharePost(page, target.pageY);
    }

    if (i < selected.length - 1) {
      const waitMs = randomInt(LOG_INTERVAL_MIN_MS, LOG_INTERVAL_MAX_MS);
      console.log(`[fb-interact] Waiting ${(waitMs / 1000).toFixed(1)}s...`);
      await sleep(waitMs);
    }
  }
}

module.exports = runFacebookHomepageInteraction;
