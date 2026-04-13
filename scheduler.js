// scheduler.js
//
// Daily runner for homepage_interaction across all listed profiles.
//
// Behaviour:
//   - Runs immediately on start
//   - After each run, sleeps until the next midnight (local time)
//   - Repeats indefinitely — keep this process alive (e.g. with pm2 or a terminal)
//
// Usage:
//   node scheduler.js
//
// To stop: Ctrl+C

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { openProfile, closeProfile } = require("./hidemium");
const runHomepageInteraction = require("./steps/homepage-interaction");
const {
  captureIssueScreenshot,
  instrumentPage,
  runWithErrorScreenshot,
  setPageContext,
  withLogContext,
} = require("./utils/runtime-monitor");

// ─── Config ──────────────────────────────────────────────────────────────────

// Add all profile UUIDs that should run every day
const PROFILE_UUIDS = [
  "local-7ffc7c92-2399-481e-821c-f6d0724ef55a",
  "local-cb754975-1f0f-49d9-a6ea-ae56b6175dd0",
];

const MAIN_TASK = runHomepageInteraction;
const MAIN_TASK_FILE = "homepage-interaction.js";
const MAIN_TASK_LABEL = MAIN_TASK_FILE.replace(".js", "");

const MAX_CONCURRENT = 3; // how many profiles run at the same time

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight local time
  return midnight - now;
}

function timestamp() {
  return new Date().toLocaleString();
}

// ─── Filler pool — auto-discovered from steps/ ───────────────────────────────
// Any .js file added to the steps/ folder is automatically a filler candidate.
// Only test-script.js and the main task file are excluded.

const EXCLUDED_FROM_FILLERS = new Set(["test-script.js", MAIN_TASK_FILE]);

const FILLER_STEPS = fs
  .readdirSync(path.join(__dirname, "steps"))
  .filter((f) => f.endsWith(".js") && !EXCLUDED_FROM_FILLERS.has(f))
  .map((f) => ({
    label: f.replace(".js", ""),
    fn: require(path.join(__dirname, "steps", f)),
  }));

console.log(`[scheduler] Filler pool: ${FILLER_STEPS.map((s) => s.label).join(", ")}\n`);

function pickFillers(count) {
  const shuffled = [...FILLER_STEPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ─── Run one profile ──────────────────────────────────────────────────────────

async function runOneProfile(uuid, index) {
  const tag = `[profile-${index + 1}:${uuid.slice(-8)}]`;
  const runTag = `profile-${index + 1}`;

  return withLogContext(
    { account: uuid.slice(-8), accountUuid: uuid, runTag },
    async () => {
      let session;
      let page;

      try {
        console.log(`${tag} Opening...`);
        session = await openProfile(uuid);
        page =
          session.context.pages().find((p) => p.url() !== "about:blank") ||
          session.context.pages()[0] ||
          (await session.context.newPage());

        setPageContext(page, {
          account: uuid.slice(-8),
          accountUuid: uuid,
          runTag,
        });
        instrumentPage(page);

        for (const filler of pickFillers(randomInt(1, 2))) {
          console.log(`${tag} Filler before: ${filler.label}`);
          await runWithErrorScreenshot(page, `filler-before-${filler.label}`, () =>
            filler.fn(page, null),
          );
          await sleep(randomInt(3000, 8000));
        }

        console.log(`${tag} Main: ${MAIN_TASK_LABEL}`);
        await runWithErrorScreenshot(page, `main-task-${MAIN_TASK_LABEL}`, () =>
          MAIN_TASK(page, null),
        );
        await sleep(randomInt(3000, 8000));

        for (const filler of pickFillers(randomInt(1, 2))) {
          console.log(`${tag} Filler after: ${filler.label}`);
          await runWithErrorScreenshot(page, `filler-after-${filler.label}`, () =>
            filler.fn(page, null),
          );
          await sleep(randomInt(3000, 8000));
        }

        console.log(`${tag} Done.`);
      } catch (err) {
        await captureIssueScreenshot(page, "scheduler-profile-error", err);
        console.error(`${tag} Error: ${err.message}`);
      } finally {
        if (session) {
          await closeProfile(uuid, session.browser);
          console.log(`${tag} Profile closed.`);
        }
      }
    },
  );
}

// ─── Run all profiles (staggered, with concurrency limit) ────────────────────

async function runAllProfiles() {
  console.log(`\n[scheduler] ${timestamp()} — Starting daily run`);
  console.log(
    `[scheduler] ${PROFILE_UUIDS.length} profile(s), max ${MAX_CONCURRENT} concurrent\n`,
  );

  const queue = [...PROFILE_UUIDS];
  const running = new Set();
  let index = 0;

  async function startNext() {
    if (queue.length === 0) return;
    const uuid = queue.shift();
    const currentIndex = index++;

    if (currentIndex > 0) {
      const staggerMs = randomInt(5000, 15000);
      console.log(
        `[scheduler] Staggering profile ${currentIndex + 1} by ${(staggerMs / 1000).toFixed(1)}s...`,
      );
      await sleep(staggerMs);
    }

    const promise = runOneProfile(uuid, currentIndex);
    running.add(promise);
    promise.finally(() => {
      running.delete(promise);
      startNext();
    });
  }

  const initialBatch = Math.min(MAX_CONCURRENT, queue.length);
  for (let i = 0; i < initialBatch; i++) startNext();

  while (running.size > 0) {
    await Promise.race(running);
  }

  console.log(`\n[scheduler] Daily run complete — ${timestamp()}`);
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  console.log("[scheduler] Started. Press Ctrl+C to stop.\n");

  while (true) {
    await runAllProfiles();

    const waitMs = msUntilMidnight();
    const waitMins = Math.round(waitMs / 60000);
    console.log(`[scheduler] Next run at midnight — waiting ${waitMins} min\n`);
    await sleep(waitMs);
  }
}

main().catch((err) => {
  console.error("[scheduler] Fatal:", err);
  process.exitCode = 1;
});
