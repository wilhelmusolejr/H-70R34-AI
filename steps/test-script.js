// test-script.js
const PROFILE_UUID =
  process.env.HIDEMIUM_PROFILE_UUID ||
  "local-cb754975-1f0f-49d9-a6ea-ae56b6175dd0";
const {
  captureIssueScreenshot,
  instrumentPage,
  setPageContext,
  waitForLoadStateWithScreenshot,
  withLogContext,
} = require("../utils/runtime-monitor");
const LIKE_SELECTOR = 'div[aria-label="Like"]';
const SCROLL_DURATION_MS = 10000;
const SCROLL_CHUNK_MIN_PX = 220;
const SCROLL_CHUNK_MAX_PX = 600;
const SCROLL_STEP_MIN_PX = 18;
const SCROLL_STEP_MAX_PX = 40;
const SCROLL_STEP_DELAY_MIN_MS = 16;
const SCROLL_STEP_DELAY_MAX_MS = 40;
const SCROLL_CHUNK_PAUSE_MIN_MS = 100;
const SCROLL_CHUNK_PAUSE_MAX_MS = 260;
const LOG_INTERVAL_MIN_MS = 10000;
const LOG_INTERVAL_MAX_MS = 20000;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function smoothScrollBy(page, distance) {
  let remaining = distance;

  while (remaining > 0) {
    const step = Math.min(
      remaining,
      randomInt(SCROLL_STEP_MIN_PX, SCROLL_STEP_MAX_PX),
    );
    await page.mouse.wheel(0, step);
    remaining -= step;
    await page.waitForTimeout(
      randomInt(SCROLL_STEP_DELAY_MIN_MS, SCROLL_STEP_DELAY_MAX_MS),
    );
  }
}

async function scrollForDuration(page, durationMs) {
  const endTime = Date.now() + durationMs;

  while (Date.now() < endTime) {
    const chunkDistance = randomInt(SCROLL_CHUNK_MIN_PX, SCROLL_CHUNK_MAX_PX);
    await smoothScrollBy(page, chunkDistance);

    const remainingMs = endTime - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await page.waitForTimeout(
      Math.min(
        remainingMs,
        randomInt(SCROLL_CHUNK_PAUSE_MIN_MS, SCROLL_CHUNK_PAUSE_MAX_MS),
      ),
    );
  }
}

async function collectLikeTargets(page) {
  const locator = page.locator(LIKE_SELECTOR);
  const total = await locator.count();
  const halfCount = Math.floor(total / 2);

  const indexes = Array.from({ length: total }, (_, i) => i);
  shuffle(indexes);
  const targetIndexes = indexes.slice(0, halfCount);
  return { total, halfCount, targetIndexes };
}

async function scrollToLikeAndGetInfo(page, index) {
  return page.evaluate(
    ({ selector, targetIndex }) => {
      const elements = Array.from(document.querySelectorAll(selector));
      const element = elements[targetIndex];

      if (!element) {
        return { found: false, className: "", box: null };
      }

      element.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });

      const className =
        typeof element.className === "string" ? element.className : "";
      const rect = element.getBoundingClientRect();
      return {
        found: true,
        className,
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    },
    { selector: LIKE_SELECTOR, targetIndex: index },
  );
}

async function runTestScript(page) {
  if (!page) {
    throw new Error("runTestScript(page) requires a Playwright page.");
  }

  console.log("Running test-script...");
  await waitForLoadStateWithScreenshot(
    page,
    "domcontentloaded",
    {},
    "test-script-domcontentloaded",
  );
  await scrollForDuration(page, SCROLL_DURATION_MS);

  const result = await collectLikeTargets(page);
  console.log(`Found ${result.total} ${LIKE_SELECTOR} elements.`);
  console.log(`Random half count: ${result.halfCount}`);

  if (result.targetIndexes.length === 0) {
    console.log("No targets selected.");
    return;
  }

  console.log("Clicking random half of Like targets:");
  for (let i = 0; i < result.targetIndexes.length; i += 1) {
    const targetIndex = result.targetIndexes[i];
    const info = await scrollToLikeAndGetInfo(page, targetIndex);
    await page.waitForTimeout(randomInt(200, 600));

    if (!info.found || !info.box) {
      await captureIssueScreenshot(page, "test-script-target-not-found");
      console.log(`#${targetIndex} skipped (element no longer present)`);
    } else {
      try {
        const cx = info.box.x + info.box.width / 2;
        const cy = info.box.y + info.box.height / 2;
        await page.mouse.click(cx, cy, {
          delay: randomInt(40, 120),
        });
        console.log(`#${targetIndex} clicked — class="${info.className}"`);
      } catch (clickError) {
        await captureIssueScreenshot(page, "test-script-click-failed", clickError);
        console.log(`#${targetIndex} click failed: ${clickError.message}`);
      }
    }

    if (i < result.targetIndexes.length - 1) {
      const waitMs = randomInt(LOG_INTERVAL_MIN_MS, LOG_INTERVAL_MAX_MS);
      console.log(`Waiting ${(waitMs / 1000).toFixed(1)}s before next log...`);
      await sleep(waitMs);
    }
  }
}

module.exports = runTestScript;

if (require.main === module) {
  const { openProfile } = require("../hidemium");

  async function getWorkingPage(context) {
    const pages = context.pages();
    if (pages.length === 0) {
      return context.newPage();
    }

    const nonBlankPage = pages.find(
      (p) => p.url() && p.url() !== "about:blank",
    );
    return nonBlankPage || pages[0];
  }

  (async () => {
    await withLogContext(
      {
        account: PROFILE_UUID.slice(-8),
        accountUuid: PROFILE_UUID,
        runTag: "test-script",
      },
      async () => {
        const session = await openProfile(PROFILE_UUID);
        const page = await getWorkingPage(session.context);
        setPageContext(page, {
          account: PROFILE_UUID.slice(-8),
          accountUuid: PROFILE_UUID,
          runTag: "test-script",
        });
        instrumentPage(page);

        console.log(`Attached to tab: ${page.url() || "about:blank"}`);

        await runTestScript(page);
        console.log("Done. Browser/profile left open for development.");
      },
    );
  })().catch((error) => {
    console.error("Direct run failed:", error);
    process.exitCode = 1;
  });
}
