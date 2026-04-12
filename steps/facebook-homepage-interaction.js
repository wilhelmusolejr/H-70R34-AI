// facebook-homepage-interaction.js
const { randomInt, scrollForDuration } = require("./utils/scroll-utils");

const LIKE_SELECTOR = 'div[aria-label="Like"]';
const SCROLL_DURATION_MIN_MS = 10000;
const SCROLL_DURATION_MAX_MS = 20000;
const SCROLL_CHUNK_PAUSE_MIN_MS = 100;
const SCROLL_CHUNK_PAUSE_MAX_MS = 260;
const LOG_INTERVAL_MIN_MS = 10000;
const LOG_INTERVAL_MAX_MS = 20000;

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- target collection ----------

async function collectTargets(page) {
  const total = await page.locator(LIKE_SELECTOR).count();
  const halfCount = Math.floor(total / 2);
  const indexes = shuffle(Array.from({ length: total }, (_, i) => i));
  return { total, halfCount, indexes: indexes.slice(0, halfCount) };
}

// ---------- scroll-to + bounding box ----------

async function scrollToAndGetInfo(page, targetIndex) {
  return page.evaluate(
    ({ selector, idx }) => {
      const elements = Array.from(document.querySelectorAll(selector));
      const el = elements[idx];
      if (!el) return { found: false, className: "", box: null };

      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });

      const rect = el.getBoundingClientRect();
      return {
        found: true,
        className: typeof el.className === "string" ? el.className : "",
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    },
    { selector: LIKE_SELECTOR, idx: targetIndex },
  );
}

// ---------- main routine ----------

async function runFacebookHomepageInteraction(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  const scrollDurationMs = randomInt(
    SCROLL_DURATION_MIN_MS,
    SCROLL_DURATION_MAX_MS,
  );
  console.log(
    `[facebook-homepage-interaction] Scroll duration: ${(scrollDurationMs / 1000).toFixed(1)}s`,
  );
  await scrollForDuration(page, scrollDurationMs, {
    chunkPauseMinMs: SCROLL_CHUNK_PAUSE_MIN_MS,
    chunkPauseMaxMs: SCROLL_CHUNK_PAUSE_MAX_MS,
  });

  const targets = await collectTargets(page);
  console.log(
    `[fb-interact] Found ${targets.total} "${LIKE_SELECTOR}" elements, selecting ${targets.halfCount}`,
  );

  if (targets.indexes.length === 0) {
    console.log("[fb-interact] No targets selected.");
    return;
  }

  for (let i = 0; i < targets.indexes.length; i += 1) {
    const targetIndex = targets.indexes[i];
    const info = await scrollToAndGetInfo(page, targetIndex);
    await page.waitForTimeout(randomInt(200, 600));

    if (!info.found || !info.box) {
      console.log(`[fb-interact] #${targetIndex} skipped (gone from DOM)`);
    } else {
      try {
        const cx = info.box.x + info.box.width / 2;
        const cy = info.box.y + info.box.height / 2;
        await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
        console.log(
          `[fb-interact] #${targetIndex} clicked — class="${info.className}"`,
        );
      } catch (err) {
        console.log(
          `[fb-interact] #${targetIndex} click failed: ${err.message}`,
        );
      }
    }

    if (i < targets.indexes.length - 1) {
      const waitMs = randomInt(LOG_INTERVAL_MIN_MS, LOG_INTERVAL_MAX_MS);
      console.log(`[fb-interact] Waiting ${(waitMs / 1000).toFixed(1)}s...`);
      await sleep(waitMs);
    }
  }
}

module.exports = runFacebookHomepageInteraction;
