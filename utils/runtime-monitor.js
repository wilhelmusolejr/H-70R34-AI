const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const logContextStore = new AsyncLocalStorage();
const PAGE_CONTEXT_KEY = Symbol("automationPageContext");
const PAGE_MONITORING_KEY = Symbol("automationPageMonitoringInstalled");
const SCREENSHOT_DIR = path.join(__dirname, "..", "artifacts", "screenshots");

let consoleFormattingInstalled = false;

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function timestamp() {
  const now = new Date();
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.` +
    `${pad(now.getMilliseconds(), 3)}`
  );
}

function sanitizeSegment(value) {
  return String(value || "unknown")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function getLogContext() {
  return logContextStore.getStore() || {};
}

function formatPrefix() {
  const ctx = getLogContext();
  const segments = [`[${timestamp()}]`];

  if (ctx.account) {
    segments.push(`[account:${ctx.account}]`);
  }

  if (ctx.runTag) {
    segments.push(`[run:${ctx.runTag}]`);
  }

  return segments.join(" ");
}

function installConsoleFormatting() {
  if (consoleFormattingInstalled) {
    return;
  }

  consoleFormattingInstalled = true;

  for (const method of ["log", "warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(formatPrefix(), ...args);
    };
  }
}

async function withLogContext(context, fn) {
  const parent = getLogContext();
  return logContextStore.run({ ...parent, ...context }, fn);
}

function setPageContext(page, context) {
  if (!page) {
    return;
  }

  page[PAGE_CONTEXT_KEY] = {
    ...(page[PAGE_CONTEXT_KEY] || {}),
    ...context,
  };
}

function getPageContext(page) {
  return (page && page[PAGE_CONTEXT_KEY]) || {};
}

function getPageLabel(page) {
  const context = getPageContext(page);
  return sanitizeSegment(
    context.runTag || context.account || context.accountUuid || "page",
  );
}

async function captureIssueScreenshot(page, label, details) {
  if (!page) {
    console.error(`[screenshot] Cannot capture "${label}" because page is missing.`);
    return null;
  }

  if (typeof page.isClosed === "function" && page.isClosed()) {
    console.error(`[screenshot] Cannot capture "${label}" because page is already closed.`);
    return null;
  }

  try {
    await fs.promises.mkdir(SCREENSHOT_DIR, { recursive: true });

    const filename =
      `${timestamp().replace(/[:. ]/g, "-")}_` +
      `${getPageLabel(page)}_${sanitizeSegment(label)}.png`;
    const filePath = path.join(SCREENSHOT_DIR, filename);

    await page.screenshot({
      path: filePath,
      fullPage: true,
    });

    if (details instanceof Error) {
      console.error(`[screenshot] Saved for "${label}" after error: ${details.message}`);
    } else if (details) {
      console.error(`[screenshot] Saved for "${label}": ${details}`);
    } else {
      console.error(`[screenshot] Saved for "${label}".`);
    }

    console.error(`[screenshot] File: ${filePath}`);
    return filePath;
  } catch (screenshotError) {
    console.error(
      `[screenshot] Failed to capture "${label}": ${screenshotError.message}`,
    );
    return null;
  }
}

async function runWithErrorScreenshot(page, label, fn) {
  try {
    return await fn();
  } catch (error) {
    await captureIssueScreenshot(page, label, error);
    throw error;
  }
}

async function waitForLoadStateWithScreenshot(page, state, options = {}, label) {
  try {
    return await page.waitForLoadState(state, options);
  } catch (error) {
    await captureIssueScreenshot(
      page,
      label || `wait-for-${sanitizeSegment(state)}`,
      error,
    );
    throw error;
  }
}

function instrumentPage(page) {
  if (!page || page[PAGE_MONITORING_KEY]) {
    return;
  }

  page[PAGE_MONITORING_KEY] = true;

  page.on("pageerror", async (error) => {
    console.error(`[pageerror] ${error.message}`);
    await captureIssueScreenshot(page, "pageerror", error);
  });

  page.on("crash", async () => {
    console.error("[pageerror] Page crashed.");
    await captureIssueScreenshot(page, "page-crash", "Page crashed");
  });
}

module.exports = {
  captureIssueScreenshot,
  getLogContext,
  installConsoleFormatting,
  instrumentPage,
  runWithErrorScreenshot,
  setPageContext,
  timestamp,
  waitForLoadStateWithScreenshot,
  withLogContext,
};
