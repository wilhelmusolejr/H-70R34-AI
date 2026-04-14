// scheduler.js
//
// Daily runner for homepage_interaction across all listed profiles.
//
// Behaviour:
//   - Runs immediately on start
//   - After each run, sleeps until a randomized time on the next day (local time)
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
  createRunSessionId,
  captureIssueScreenshot,
  instrumentPage,
  runWithErrorScreenshot,
  setPageContext,
  withLogContext,
} = require("./utils/runtime-monitor");

// ─── Config ──────────────────────────────────────────────────────────────────

// Add all profile UUIDs that should run every day
const PROFILE_UUIDS = ["local-cb754975-1f0f-49d9-a6ea-ae56b6175dd0"];

const MAIN_TASK = runHomepageInteraction;
const MAIN_TASK_FILE = "homepage-interaction.js";
const MAIN_TASK_LABEL = MAIN_TASK_FILE.replace(".js", "");

const MAX_CONCURRENT = 3; // how many profiles run at the same time
const TEST_MODE = false; // true = skip filler and run only the main task
const NEXT_RUN_WINDOW_START_HOUR = 0;
const NEXT_RUN_WINDOW_START_MINUTE = 30;
const NEXT_RUN_WINDOW_END_HOUR = 1;
const NEXT_RUN_WINDOW_END_MINUTE = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msUntilMidnight() {
  const now = new Date();
  return getNextRunTime(now) - now;
}

function timestamp() {
  return new Date().toLocaleString();
}

function getNextRunTime(fromTime = new Date()) {
  const nextRun = new Date(fromTime);
  nextRun.setDate(nextRun.getDate() + 1);

  const windowStart = new Date(nextRun);
  windowStart.setHours(
    NEXT_RUN_WINDOW_START_HOUR,
    NEXT_RUN_WINDOW_START_MINUTE,
    0,
    0,
  );

  const windowEnd = new Date(nextRun);
  windowEnd.setHours(
    NEXT_RUN_WINDOW_END_HOUR,
    NEXT_RUN_WINDOW_END_MINUTE,
    0,
    0,
  );

  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const randomMs = randomInt(0, Math.max(0, endMs - startMs));

  return new Date(startMs + randomMs);
}

// ─── Filler pool — auto-discovered from steps/ ───────────────────────────────
// Any .js file added to the steps/ folder is automatically a filler candidate.
// Only test-script.js and the main task file are excluded.

const EXCLUDED_FROM_FILLERS = new Set(["test-script.js", MAIN_TASK_FILE]);
const FILLER_WEIGHTS = {
  "search-interaction.js": 3,
  "profile-interaction.js": 1,
};

const FILLER_STEPS = fs
  .readdirSync(path.join(__dirname, "steps"))
  .filter((f) => f.endsWith(".js") && !EXCLUDED_FROM_FILLERS.has(f))
  .map((f) => ({
    label: f.replace(".js", ""),
    file: f,
    fn: require(path.join(__dirname, "steps", f)),
  }));

console.log(
  `[scheduler] Filler pool: ${FILLER_STEPS.map((s) => s.label).join(", ")}\n`,
);

function pickFillers(count) {
  const weighted = FILLER_STEPS.flatMap((step) =>
    Array.from(
      { length: FILLER_WEIGHTS[step.file] || 1 },
      () => step,
    ),
  );
  const shuffled = [...weighted].sort(() => Math.random() - 0.5);
  const picked = [];
  const seenFiles = new Set();

  for (const step of shuffled) {
    if (seenFiles.has(step.file)) {
      continue;
    }

    picked.push(step);
    seenFiles.add(step.file);

    if (picked.length >= Math.min(count, FILLER_STEPS.length)) {
      break;
    }
  }

  return picked;
}

// ─── Run one profile ──────────────────────────────────────────────────────────

async function runOneProfile(uuid, index) {
  const tag = `[profile-${index + 1}:${uuid.slice(-8)}]`;
  const runTag = `profile-${index + 1}`;
  const runSessionId = createRunSessionId();

  return withLogContext(
    { account: uuid.slice(-8), accountUuid: uuid, runTag, runSessionId },
    async () => {
      let session;
      let page;

      try {
        console.log(`${tag} Opening...`);
        console.log(`${tag} Session started: ${runSessionId}`);
        session = await openProfile(uuid);
        page =
          session.context.pages().find((p) => p.url() !== "about:blank") ||
          session.context.pages()[0] ||
          (await session.context.newPage());

        setPageContext(page, {
          account: uuid.slice(-8),
          accountUuid: uuid,
          runTag,
          runSessionId,
        });
        instrumentPage(page);

        if (!TEST_MODE) {
          for (const filler of pickFillers(randomInt(1, 2))) {
            console.log(`${tag} Filler before: ${filler.label}`);
            await runWithErrorScreenshot(
              page,
              `filler-before-${filler.label}`,
              () => filler.fn(page, null),
            );
            await sleep(randomInt(3000, 8000));
          }
        } else {
          console.log(
            `${tag} Test mode enabled - skipping filler before main task.`,
          );
        }

        console.log(`${tag} Main: ${MAIN_TASK_LABEL}`);
        await runWithErrorScreenshot(page, `main-task-${MAIN_TASK_LABEL}`, () =>
          MAIN_TASK(page, null),
        );
        await sleep(randomInt(3000, 8000));

        if (!TEST_MODE) {
          for (const filler of pickFillers(randomInt(1, 2))) {
            console.log(`${tag} Filler after: ${filler.label}`);
            await runWithErrorScreenshot(
              page,
              `filler-after-${filler.label}`,
              () => filler.fn(page, null),
            );
            await sleep(randomInt(3000, 8000));
          }
        } else {
          console.log(
            `${tag} Test mode enabled - skipping filler after main task.`,
          );
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
  console.log(`[scheduler] Test mode: ${TEST_MODE ? "enabled" : "disabled"}\n`);

  while (true) {
    await runAllProfiles();

    const nextRunAt = getNextRunTime();
    const waitMs = nextRunAt - new Date();
    const waitMins = Math.round(waitMs / 60000);
    console.log(
      `[scheduler] Next run scheduled for ${nextRunAt.toLocaleString()} — waiting ${waitMins} min\n`,
    );
    await sleep(waitMs);
  }
}

main().catch((err) => {
  console.error("[scheduler] Fatal:", err);
  process.exitCode = 1;
});
