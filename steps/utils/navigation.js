// navigation.js — shared "navigate only if needed" helper

const NAV_RETRIES = 5;   // max retries for general navigation errors (proxy, connection)
const TIMEOUT_RETRIES = 10; // max retries for timeout errors (slow proxy)
const RETRY_WAIT_MS = 5000; // wait between retries
const {
  captureIssueScreenshot,
  waitForLoadStateWithScreenshot,
} = require("../../utils/runtime-monitor");

function isTimeoutError(err) {
  const msg = err.message || "";
  return (
    msg.includes("Timeout") ||
    msg.includes("timeout") ||
    msg.includes("TimeoutError")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  let lastErr;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch (networkIdleError) {
        console.warn(
          `[nav] networkidle did not settle for ${targetUrl}; continuing because domcontentloaded already succeeded: ${networkIdleError.message}`,
        );
      }
      console.log(`[nav] Navigated to ${targetUrl}`);
      return;
    } catch (err) {
      lastErr = err;
      await captureIssueScreenshot(page, "navigation-error", err);

      const maxRetries = isTimeoutError(err) ? TIMEOUT_RETRIES : NAV_RETRIES;
      const kind = isTimeoutError(err) ? "timeout" : "navigation error";

      if (attempt >= maxRetries) {
        console.error(
          `[nav] ${kind} — all ${maxRetries} retries exhausted for ${targetUrl}: ${err.message}`,
        );
        throw err;
      }

      console.warn(
        `[nav] ${kind} (attempt ${attempt}/${maxRetries}) for ${targetUrl}: ${err.message}`,
      );
      console.warn(`[nav] Retrying in ${RETRY_WAIT_MS / 1000}s...`);
      await sleep(RETRY_WAIT_MS);
    }
  }
}

module.exports = { ensureUrl };
