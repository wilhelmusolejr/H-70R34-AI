// profile-interaction.js
const { randomInt, scrollForDuration } = require("./utils/scroll-utils");
const { ensureUrl } = require("./utils/navigation");
const { getRandomProfileUrl } = require("../data/profile-urls");

const LIKE_SELECTOR = 'div[aria-label="Like"]';
const LIKE_TRACKING_ATTR = "data-profile-interaction-like-id";
const INITIAL_SCROLL_MIN_MS = 20000;
const INITIAL_SCROLL_MAX_MS = 40000;
const COLLECT_INTERVAL_MS = 2000; // snapshot DOM every 2s while scrolling
const INTERACTION_WAIT_MIN_MS = 10000;
const INTERACTION_WAIT_MAX_MS = 15000;

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

// ---------- tag any untagged Like elements currently in DOM ----------

async function tagVisibleLikes(page) {
  return page.evaluate(
    ({ selector, attr }) => {
      const elements = Array.from(document.querySelectorAll(selector));
      let newCount = 0;

      for (let i = 0; i < elements.length; i += 1) {
        if (!elements[i].getAttribute(attr)) {
          const id = `like-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
          elements[i].setAttribute(attr, id);
          newCount += 1;
        }
      }

      return newCount;
    },
    { selector: LIKE_SELECTOR, attr: LIKE_TRACKING_ATTR },
  );
}

// ---------- scroll + collect: tag elements as they enter the DOM ----------

async function scrollAndCollect(page, durationMs) {
  const endTime = Date.now() + durationMs;
  let totalTagged = 0;

  // tag whatever is already on screen
  totalTagged += await tagVisibleLikes(page);

  while (Date.now() < endTime) {
    // scroll one chunk (human-like)
    const chunkMs = Math.min(COLLECT_INTERVAL_MS, endTime - Date.now());
    await scrollForDuration(page, chunkMs);

    // snapshot — tag any new elements that just appeared
    totalTagged += await tagVisibleLikes(page);
  }

  console.log(
    `[profile-interaction] Tagged ${totalTagged} Like elements during scroll.`,
  );
  return totalTagged;
}

// ---------- gather all tagged IDs + their page positions ----------

async function gatherTaggedPositions(page) {
  return page.evaluate(
    ({ attr }) => {
      const tagged = Array.from(document.querySelectorAll(`[${attr}]`));
      return tagged.map((el) => ({
        id: el.getAttribute(attr),
        pageY: window.scrollY + el.getBoundingClientRect().y,
      }));
    },
    { attr: LIKE_TRACKING_ATTR },
  );
}

// ---------- human scroll to a page-Y coordinate (up + down) ----------

async function humanScrollTo(page, targetPageY) {
  const viewport = await page.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
  }));

  const desiredScrollY = Math.max(0, targetPageY - viewport.innerHeight / 2);
  let distance = desiredScrollY - viewport.scrollY;

  if (Math.abs(distance) < 10) return;

  const direction = distance > 0 ? 1 : -1;
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

// ---------- get fresh viewport box for a tagged element ----------

async function getTaggedElementBox(page, targetId) {
  return page.evaluate(
    ({ attr, id, selector }) => {
      // first try by tracking attribute
      let el = document.querySelector(`${selector}[${attr}="${id}"]`);

      // fallback: the element might have been recycled by React,
      // so the attr is gone but a Like button is in roughly the same spot
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    { attr: LIKE_TRACKING_ATTR, id: targetId, selector: LIKE_SELECTOR },
  );
}

// ---------- main routine ----------

async function runProfileInteraction(page, data) {
  const targetUrl = (data && data.url) || getRandomProfileUrl();
  console.log(`[profile-interaction] Target profile: ${targetUrl}`);
  await ensureUrl(page, targetUrl);

  // scroll and collect targets simultaneously
  const scrollMs = randomInt(INITIAL_SCROLL_MIN_MS, INITIAL_SCROLL_MAX_MS);
  console.log(
    `[profile-interaction] Scroll+collect: ${(scrollMs / 1000).toFixed(1)}s`,
  );
  await scrollAndCollect(page, scrollMs);

  // now gather whatever tagged elements are still in DOM
  // (only a few will remain due to virtualization — that's expected)
  // but we tagged many during scrolling, so we know their approximate pageY
  const positions = await gatherTaggedPositions(page);
  console.log(
    `[profile-interaction] ${positions.length} tagged elements still in DOM.`,
  );

  // since most tags get destroyed by virtualization, we need a different approach:
  // scroll back through the page and re-discover Like buttons at each stop
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);

  // build a list of scroll stops to revisit the page
  const stops = [];
  for (let y = 0; y < scrollHeight; y += Math.floor(viewportHeight * 0.7)) {
    stops.push(y);
  }

  // scroll to top first
  console.log(
    "[profile-interaction] Scrolling to top to start collection pass...",
  );
  await humanScrollTo(page, 0);
  await page.waitForTimeout(randomInt(500, 1000));

  // collect all Like positions by scrolling through the page again
  const allTargets = [];
  const seenPositions = new Set(); // dedupe by rough pageY

  for (const stopY of stops) {
    await humanScrollTo(page, stopY + viewportHeight / 2);
    await page.waitForTimeout(randomInt(300, 600));

    const visible = await page.evaluate(
      ({ selector }) => {
        return Array.from(document.querySelectorAll(selector)).map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            pageY: Math.round(window.scrollY + rect.y),
            viewportY: rect.y,
            width: rect.width,
            height: rect.height,
            x: rect.x,
          };
        });
      },
      { selector: LIKE_SELECTOR },
    );

    for (const v of visible) {
      // dedupe: skip if we already recorded a target within 50px of this one
      const key = Math.round(v.pageY / 50) * 50;
      if (!seenPositions.has(key)) {
        seenPositions.add(key);
        allTargets.push(v);
      }
    }
  }

  console.log(
    `[profile-interaction] Collected ${allTargets.length} unique Like targets.`,
  );

  if (allTargets.length === 0) {
    console.log("[profile-interaction] No Like elements found. Skipping.");
    return;
  }

  // select random half
  const shuffled = shuffle([...allTargets]);
  const selected = shuffled.slice(
    0,
    Math.max(1, Math.floor(allTargets.length / 2)),
  );
  console.log(
    `[profile-interaction] Clicking ${selected.length} random targets.`,
  );

  for (let i = 0; i < selected.length; i += 1) {
    const target = selected[i];

    // scroll to the target's page position
    await humanScrollTo(page, target.pageY);
    await page.waitForTimeout(randomInt(250, 600));

    // get the fresh bounding box of the nearest Like button in viewport center
    const box = await page.evaluate(
      ({ selector }) => {
        const els = Array.from(document.querySelectorAll(selector));
        // find the one closest to vertical center of viewport
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
        `[profile-interaction] Target at pageY=${target.pageY} not found after scroll.`,
      );
      continue;
    }

    try {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx, cy, { delay: randomInt(40, 120) });
      console.log(
        `[profile-interaction] Clicked Like at pageY≈${target.pageY}`,
      );
    } catch (err) {
      console.log(
        `[profile-interaction] Click failed at pageY≈${target.pageY}: ${err.message}`,
      );
    }

    if (i < selected.length - 1) {
      const waitMs = randomInt(
        INTERACTION_WAIT_MIN_MS,
        INTERACTION_WAIT_MAX_MS,
      );
      console.log(
        `[profile-interaction] Waiting ${(waitMs / 1000).toFixed(1)}s...`,
      );
      await sleep(waitMs);
    }
  }
}

module.exports = runProfileInteraction;
