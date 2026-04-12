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

const { openProfile, closeProfile } = require("./hidemium");
const runHomepageInteraction = require("./steps/homepage-interaction");
const runProfileInteraction = require("./steps/profile-interaction");

// ─── Config ──────────────────────────────────────────────────────────────────

// Add all profile UUIDs that should run every day
const PROFILE_UUIDS = [
  "local-cb754975-1f0f-49d9-a6ea-ae56b6175dd0",
  // "local-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  // add more...
];

const MAIN_TASK = runHomepageInteraction;
const MAIN_TASK_LABEL = "homepage_interaction";

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

// ─── Filler pool (excludes main task and test scripts) ───────────────────────

const FILLER_STEPS = [
  { label: "profile_interaction", fn: runProfileInteraction },
];

function pickFillers(count) {
  const shuffled = [...FILLER_STEPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ─── Run one profile ──────────────────────────────────────────────────────────

async function runOneProfile(uuid, index) {
  const tag = `[profile-${index + 1}:${uuid.slice(-8)}]`;

  let session;
  try {
    console.log(`${tag} Opening...`);
    session = await openProfile(uuid);
    const page =
      session.context.pages().find((p) => p.url() !== "about:blank") ||
      session.context.pages()[0] ||
      (await session.context.newPage());

    // filler before
    for (const filler of pickFillers(randomInt(1, 2))) {
      console.log(`${tag} Filler before: ${filler.label}`);
      await filler.fn(page, null);
      await sleep(randomInt(3000, 8000));
    }

    // main task
    console.log(`${tag} Main: ${MAIN_TASK_LABEL}`);
    await MAIN_TASK(page, null);
    await sleep(randomInt(3000, 8000));

    // filler after
    for (const filler of pickFillers(randomInt(1, 2))) {
      console.log(`${tag} Filler after: ${filler.label}`);
      await filler.fn(page, null);
      await sleep(randomInt(3000, 8000));
    }

    console.log(`${tag} Done.`);
  } catch (err) {
    console.error(`${tag} Error: ${err.message}`);
  } finally {
    if (session) {
      await closeProfile(uuid, session.browser);
      console.log(`${tag} Profile closed.`);
    }
  }
}

// ─── Run all profiles (staggered, with concurrency limit) ────────────────────

async function runAllProfiles() {
  console.log(`\n[scheduler] ${timestamp()} — Starting daily run`);
  console.log(`[scheduler] ${PROFILE_UUIDS.length} profile(s), max ${MAX_CONCURRENT} concurrent\n`);

  const queue = [...PROFILE_UUIDS];
  const running = new Set();
  let index = 0;

  async function startNext() {
    if (queue.length === 0) return;
    const uuid = queue.shift();
    const currentIndex = index++;

    if (currentIndex > 0) {
      const staggerMs = randomInt(5000, 15000);
      console.log(`[scheduler] Staggering profile ${currentIndex + 1} by ${(staggerMs / 1000).toFixed(1)}s...`);
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
