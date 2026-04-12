const {
  randomInt,
  scrollForDuration,
  humanScrollTo,
} = require("./utils/scroll-utils");

const SEARCH_INPUT_SELECTOR = [
  'input[aria-label="Search Facebook"][type="search"]',
  'input[placeholder="Search Facebook"][role="combobox"]',
  'input[type="search"][role="combobox"]',
].join(", ");

const LIKE_SELECTOR = 'div[aria-label="Like"]';
const ADD_FRIEND_SELECTOR = '[aria-label="Add friend"]';
const FOLLOW_SELECTOR = '[aria-label="Follow"]';
const RESULT_SCROLL_MIN_MS = 5000;
const RESULT_SCROLL_MAX_MS = 15000;
const FIRST_NAMES = [
  "James",
  "Michael",
  "Robert",
  "John",
  "David",
  "William",
  "Daniel",
  "Joseph",
  "Christopher",
  "Anthony",
  "Jennifer",
  "Jessica",
  "Ashley",
  "Emily",
  "Sarah",
  "Amanda",
  "Melissa",
  "Nicole",
  "Elizabeth",
  "Rachel",
];
const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
  "Martin",
  "Jackson",
  "Thompson",
  "White",
  "Harris",
  "Clark",
];

function getSearchQuery() {
  const manualQuery = String(process.env.FACEBOOK_SEARCH_QUERY || "").trim();
  if (manualQuery) {
    return manualQuery;
  }

  const firstName = FIRST_NAMES[randomInt(0, FIRST_NAMES.length - 1)];
  const lastName = LAST_NAMES[randomInt(0, LAST_NAMES.length - 1)];
  return `${firstName} ${lastName}`;
}

async function findSearchInputBox(page) {
  return page.evaluate((selector) => {
    const input = document.querySelector(selector);
    if (!input) return null;

    const rect = input.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }, SEARCH_INPUT_SELECTOR);
}

async function humanType(page, text) {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(60, 170) });
    await page.waitForTimeout(randomInt(20, 90));
  }
}

async function collectTargets(page, selector) {
  return page.evaluate((targetSelector) => {
    return Array.from(document.querySelectorAll(targetSelector)).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        pageY: Math.round(window.scrollY + rect.y),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    });
  }, selector);
}

async function findNearestBox(page, selector) {
  return page.evaluate((targetSelector) => {
    const elements = Array.from(document.querySelectorAll(targetSelector));
    if (elements.length === 0) return null;

    const viewportCenter = window.innerHeight / 2;
    let best = null;
    let bestDistance = Infinity;

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const distance = Math.abs(rect.y + rect.height / 2 - viewportCenter);

      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }
    }

    return best;
  }, selector);
}

async function clickRandomTarget(page, selector, label) {
  const targets = await collectTargets(page, selector);
  console.log(
    `[search-interaction] Found ${targets.length} "${label}" elements.`,
  );

  if (targets.length === 0) {
    console.log(`[search-interaction] No ${label} buttons found.`);
    return false;
  }

  const target = targets[randomInt(0, targets.length - 1)];
  await humanScrollTo(page, target.pageY);
  await page.waitForTimeout(randomInt(250, 700));

  const box = await findNearestBox(page, selector);
  if (!box) {
    console.log(
      `[search-interaction] Random ${label} button not found after scroll.`,
    );
    return false;
  }

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
  console.log(`[search-interaction] Clicked one random ${label} button.`);
  return true;
}

async function maybeClickRandomAddFriend(page) {
  const shouldAddFriend = randomInt(0, 1) === 1;
  if (!shouldAddFriend) {
    console.log("[search-interaction] Skipping Add Friend this run.");
    return;
  }

  await clickRandomTarget(page, ADD_FRIEND_SELECTOR, "Add friend");
}

async function maybeClickRandomFollow(page) {
  const shouldFollow = randomInt(0, 1) === 1;
  if (!shouldFollow) {
    console.log("[search-interaction] Skipping Follow this run.");
    return;
  }

  await clickRandomTarget(page, FOLLOW_SELECTOR, "Follow");
}

async function runSearchInteraction(page) {
  const searchQuery = getSearchQuery();

  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(randomInt(700, 1400));

  const searchBox = await findSearchInputBox(page);
  if (!searchBox) {
    console.log("[search-interaction] Search input not found.");
    return;
  }

  const cx = searchBox.x + searchBox.width / 2;
  const cy = searchBox.y + searchBox.height / 2;
  await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
  await page.waitForTimeout(randomInt(300, 700));

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+A" : "Control+A",
  );
  await page.waitForTimeout(randomInt(120, 260));
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(randomInt(180, 320));

  console.log(`[search-interaction] Typing query: "${searchQuery}"`);
  await humanType(page, searchQuery);
  await page.waitForTimeout(randomInt(400, 900));
  await page.keyboard.press("Enter");

  console.log("[search-interaction] Submitted search with Enter.");
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(randomInt(800, 1400));

  const browseMs = randomInt(RESULT_SCROLL_MIN_MS, RESULT_SCROLL_MAX_MS);
  console.log(
    `[search-interaction] Browsing search results for ${(browseMs / 1000).toFixed(1)}s.`,
  );
  await scrollForDuration(page, browseMs);

  await clickRandomTarget(page, LIKE_SELECTOR, "Like");
  await page.waitForTimeout(randomInt(800, 1600));
  await maybeClickRandomAddFriend(page);
  await page.waitForTimeout(randomInt(800, 1600));
  await maybeClickRandomFollow(page);
}

module.exports = runSearchInteraction;
