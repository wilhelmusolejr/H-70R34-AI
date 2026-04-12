// navigation.js — shared "navigate only if needed" helper

function urlMatches(currentUrl, targetUrl, matchOriginOnly) {
  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);

    if (matchOriginOnly) {
      return current.origin === target.origin;
    }

    // compare origin + pathname (trim trailing slashes)
    return (
      current.origin === target.origin &&
      current.pathname.replace(/\/+$/, "") ===
        target.pathname.replace(/\/+$/, "")
    );
  } catch {
    return false;
  }
}

async function ensureUrl(page, targetUrl, options = {}) {
  const currentUrl = page.url();

  if (urlMatches(currentUrl, targetUrl, options.matchOriginOnly)) {
    console.log(`[nav] Already on ${targetUrl}, skipping navigation`);
    return;
  }

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  console.log(`[nav] Navigated to ${targetUrl}`);
}

module.exports = { ensureUrl };
