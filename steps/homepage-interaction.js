// homepage-interaction.js
//
// Flow:
//   1. ensureUrl — navigate to facebook.com if not already there (origin-only match)
//   2. Initial scroll — browse the feed for 10–20 s to simulate a real user reading
//   3. Scroll to top, then collection pass — crawl feed top-to-bottom, recording
//      the pageY of every Like button (deduped by 50 px buckets)
//   4. Shuffle collected targets, select a random half to like
//   5. Pick 1–3 random posts from that half to share
//   6. Pass 2 — scroll to each selected target:
//        a. Click the Like button closest to the viewport centre
//        b. If this post was chosen for sharing: open the share modal,
//           optionally type SHARE_MESSAGE, then click Share now
//        c. Wait 10–20 s between interactions
//
const {
  randomInt,
  scrollForDuration,
  shuffle,
  sleep,
  humanScrollTo,
} = require("./utils/scroll-utils");
const { ensureUrl } = require("./utils/navigation");
const { generateShareMessage } = require("./utils/generate-share-message");
const {
  captureIssueScreenshot,
  waitForLoadStateWithScreenshot,
} = require("../utils/runtime-monitor");

const HOME_BUTTON_SELECTOR = '[aria-label="Home"]';

// Click the Home button — the profile is already on Facebook from the filler step.
// Falls back to navigating only if the Home button isn't found.
async function ensureHomePage(page) {
  const homeBtn = await page.$(HOME_BUTTON_SELECTOR);
  if (homeBtn) {
    await homeBtn.click();
    await waitForLoadStateWithScreenshot(
      page,
      "domcontentloaded",
      {},
      "home-button-domcontentloaded",
    );
    console.log("[fb-interact] Clicked Home button");
    return;
  }

  // Fallback: Home button not found (e.g. page is blank or not on Facebook yet)
  await captureIssueScreenshot(page, "home-button-not-found");
  console.log(
    "[fb-interact] Home button not found — navigating to facebook.com",
  );
  await ensureUrl(page, "https://www.facebook.com/");
}

// Who the automation is acting as — used as the AI persona when generating messages
const USER_IDENTITY =
  "a casual Facebook user who writes like they are texting a friend—short, low-effort, and uses lowercase";
// What kind of content is being shared — gives the AI context for the message tone
const POST_CONTEXT = "a post from my Facebook feed";

const LIKE_SELECTOR = 'div[aria-label="Like"]';
const SHARE_BUTTON_SELECTOR =
  '[aria-label="Send this to friends or post it on your profile."]';
const SHARE_DIALOG_SELECTOR = 'div[role="dialog"]';
const SHARE_CLOSE_SELECTOR = 'div[role="dialog"] [aria-label="Close"]';
const SHARE_NOW_SELECTOR = '[aria-label="Share now"]';
const SHARE_TEXTBOX_SELECTORS = [
  'div[role="dialog"] div[contenteditable="true"][role="textbox"][aria-placeholder="Say something about this..."]',
  'div[role="dialog"] div[contenteditable="true"][role="textbox"]',
];
const SHARE_COUNT_MIN = 1;
const SHARE_COUNT_MAX = 3;
const SHARE_MODAL_WAIT_ATTEMPTS = 10;
const SHARE_MODAL_WAIT_TIMEOUT_MS = 30000;
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

async function hasShareButtonNearTarget(page, targetPageY) {
  await humanScrollTo(page, targetPageY);
  await page.waitForTimeout(randomInt(250, 600));

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

  return Boolean(shareBox);
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

async function getAvailableShareTextboxSelector(page) {
  for (const selector of SHARE_TEXTBOX_SELECTORS) {
    const exists = await page.$(selector);
    if (exists) {
      return selector;
    }
  }

  return null;
}

async function waitForShareModalReady(page) {
  for (let attempt = 1; attempt <= SHARE_MODAL_WAIT_ATTEMPTS; attempt += 1) {
    try {
      await page.waitForSelector(SHARE_DIALOG_SELECTOR, {
        timeout: SHARE_MODAL_WAIT_TIMEOUT_MS,
      });

      const modalStateHandle = await page.waitForFunction(
        ({ textboxSelectors, shareNowSelector, dialogSelector }) => {
          const hasDialog = Boolean(document.querySelector(dialogSelector));
          const hasTextbox = textboxSelectors.some((selector) =>
            Boolean(document.querySelector(selector)),
          );
          const hasShareNow = Boolean(document.querySelector(shareNowSelector));

          if (!hasDialog || (!hasTextbox && !hasShareNow)) {
            return null;
          }

          return { hasDialog, hasTextbox, hasShareNow };
        },
        {
          textboxSelectors: SHARE_TEXTBOX_SELECTORS,
          shareNowSelector: SHARE_NOW_SELECTOR,
          dialogSelector: SHARE_DIALOG_SELECTOR,
        },
        { timeout: SHARE_MODAL_WAIT_TIMEOUT_MS },
      );

      return await modalStateHandle.jsonValue();
    } catch (error) {
      console.warn(
        `[fb-interact] Share modal not ready yet (attempt ${attempt}/${SHARE_MODAL_WAIT_ATTEMPTS}): ${error.message}`,
      );

      if (attempt === SHARE_MODAL_WAIT_ATTEMPTS) {
        await captureIssueScreenshot(page, "share-modal-not-ready", error);
        return null;
      }
    }
  }

  return null;
}

async function closeShareModal(page) {
  const closeButton = await page.$(SHARE_CLOSE_SELECTOR);
  if (closeButton) {
    await closeButton.click({ delay: randomInt(40, 120) }).catch(() => {});
    await page.waitForTimeout(randomInt(400, 800));
    console.log("[fb-interact] Closed share modal with Close button.");
    return true;
  }

  const dialogBox = await page.evaluate((selector) => {
    const dialog = document.querySelector(selector);
    if (!dialog) return null;

    const rect = dialog.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, SHARE_DIALOG_SELECTOR);

  if (!dialogBox) {
    return false;
  }

  const clickX = Math.max(8, dialogBox.x - 20);
  const clickY = Math.max(8, dialogBox.y - 20);
  await page.mouse.click(clickX, clickY, { delay: randomInt(40, 120) });
  await page.waitForTimeout(randomInt(400, 800));
  console.log("[fb-interact] Closed share modal by clicking outside the dialog.");
  return true;
}

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
    await captureIssueScreenshot(page, "share-button-not-found");
    console.log(`[fb-interact] Share button not found at pageY≈${targetPageY}`);
    return false;
  }

  // click the share button
  const cx = shareBox.x + shareBox.width / 2;
  const cy = shareBox.y + shareBox.height / 2;
  await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
  console.log(`[fb-interact] Clicked Share button at pageY≈${targetPageY}`);

  const modalState = await waitForShareModalReady(page);
  if (!modalState) {
    await closeShareModal(page).catch(() => {});
    console.log("[fb-interact] Share modal did not become ready.");
    return false;
  }
  await page.waitForTimeout(randomInt(800, 1500));

  const textboxSelector = modalState.hasTextbox
    ? await getAvailableShareTextboxSelector(page)
    : null;
  const message = modalState.hasTextbox
    ? await generateShareMessage(USER_IDENTITY, POST_CONTEXT)
    : "";

  // type the message in the textbox (skip if message is empty)
  if (textboxSelector && message) {
    try {
      await humanType(page, textboxSelector, message);
      console.log(`[fb-interact] Typed share message: "${message}"`);
    } catch (error) {
      await captureIssueScreenshot(page, "share-textbox-not-found", error);
      console.log("[fb-interact] Share textbox not found in modal.");
      await closeShareModal(page).catch(() => {});
      return false;
    }
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
    await captureIssueScreenshot(page, "share-now-not-found");
    console.log("[fb-interact] Share now button not found.");
    await closeShareModal(page).catch(() => {});
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

async function runHomepageInteraction(page) {
  await ensureHomePage(page);

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

  // pick 1–3 random targets from the selected half to share
  const requestedShareCount = Math.min(
    randomInt(SHARE_COUNT_MIN, SHARE_COUNT_MAX),
    selected.length,
  );
  const candidateShareIndexes = shuffle(
    Array.from({ length: selected.length }, (_, index) => index),
  );
  const shareableIndexes = [];

  for (const candidateIndex of candidateShareIndexes) {
    const candidateTarget = selected[candidateIndex];
    const isShareable = await hasShareButtonNearTarget(
      page,
      candidateTarget.pageY,
    );

    if (!isShareable) {
      console.log(
        `[fb-interact] Share button not available for target at pageY≈${candidateTarget.pageY}, choosing another post.`,
      );
      continue;
    }

    shareableIndexes.push(candidateIndex);
  }

  if (shareableIndexes.length < requestedShareCount) {
    console.log(
      `[fb-interact] Only found ${shareableIndexes.length} shareable post(s) out of requested ${requestedShareCount}.`,
    );
  }

  const shareCandidateSet = new Set(shareableIndexes);
  console.log(
    `[fb-interact] Need ${requestedShareCount} successful share(s). Candidate indexes: ${shareableIndexes.join(", ")}`,
  );

  // pass 2: scroll to each target and click
  let successfulShares = 0;
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
      await captureIssueScreenshot(page, "homepage-like-target-not-found");
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
      await captureIssueScreenshot(page, "homepage-like-click-failed", err);
      console.log(
        `[fb-interact] Click failed at pageY≈${target.pageY}: ${err.message}`,
      );
    }

    // share this post if it's one of the chosen ones
    if (
      successfulShares < requestedShareCount &&
      shareCandidateSet.has(i)
    ) {
      await page.waitForTimeout(randomInt(1000, 2000));
      const didShare = await sharePost(page, target.pageY);
      if (didShare) {
        successfulShares += 1;
        console.log(
          `[fb-interact] Successful shares: ${successfulShares}/${requestedShareCount}`,
        );
      } else {
        console.log(
          `[fb-interact] Share failed for target at pageY≈${target.pageY}. Continuing to the next post without deducting the share target.`,
        );
      }
    }

    if (i < selected.length - 1) {
      const waitMs = randomInt(LOG_INTERVAL_MIN_MS, LOG_INTERVAL_MAX_MS);
      console.log(`[fb-interact] Waiting ${(waitMs / 1000).toFixed(1)}s...`);
      await sleep(waitMs);
    }
  }

  if (successfulShares < requestedShareCount) {
    console.log(
      `[fb-interact] Finished with ${successfulShares}/${requestedShareCount} successful share(s).`,
    );
  }
}

module.exports = runHomepageInteraction;
