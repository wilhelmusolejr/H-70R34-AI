// adding-friend-step.js
const PROFILE_URL = process.env.FACEBOOK_PROFILE_URL || "";

function normalizeText(value) {
  return (value || "").trim().toLowerCase();
}

async function findAddFriendControl(page) {
  return page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('button, div[role="button"], a[role="button"]'),
    );

    for (const el of candidates) {
      const text = (el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").trim();
      const combined = `${text} ${aria}`.toLowerCase();

      if (combined.includes("add friend")) {
        const rect = el.getBoundingClientRect();
        return {
          found: true,
          text,
          ariaLabel: aria,
          className: typeof el.className === "string" ? el.className : "",
          box: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      }
    }

    return { found: false };
  });
}

async function runAddingFriendStep(page) {
  if (!PROFILE_URL || !PROFILE_URL.startsWith("http")) {
    throw new Error(
      "Set FACEBOOK_PROFILE_URL (full https URL) before running STEP_KEY=adding_friend.",
    );
  }

  await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log(`[adding_friend] Opened profile URL: ${PROFILE_URL}`);

  const info = await findAddFriendControl(page);
  if (!info.found) {
    console.log("[adding_friend] Add Friend control not found.");
    return;
  }

  await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('button, div[role="button"], a[role="button"]'),
    );
    const target = nodes.find((el) => {
      const text = (el.textContent || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      return `${text} ${aria}`.includes("add friend");
    });
    if (target) {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    }
  });

  console.log(
    `[adding_friend] would_click text="${normalizeText(info.text)}" aria="${normalizeText(info.ariaLabel)}" class="${info.className}"`,
  );
}

module.exports = runAddingFriendStep;
