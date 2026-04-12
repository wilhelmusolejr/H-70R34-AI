// multi-profile.js
// Usage:
//   node multi-profile.js --task profile_interaction --url https://facebook.com/someone --uuids uuid1,uuid2,uuid3
//   node multi-profile.js --task homepage_interaction --uuids uuid1,uuid2,uuid3,uuid4,uuid5
//
// Each profile runs: random filler → main task → random filler
// Profiles start with staggered delays so they don't all hit Facebook at the same instant.

const { openProfile, closeProfile } = require("./hidemium");

// ---------- step registry (same as single-profile.js) ----------

const FILLER_STEPS = {
  homepage_interaction: {
    module: require("./steps/homepage-interaction"),
    label: "Facebook Homepage Interaction",
  },
  profile_interaction: {
    module: require("./steps/profile-interaction"),
    label: "Profile Interaction",
  },
};

const MAIN_TASKS = {
  homepage_interaction: {
    module: require("./steps/homepage-interaction"),
    label: "Facebook Homepage Interaction",
    requiredData: [],
  },
  profile_interaction: {
    module: require("./steps/profile-interaction"),
    label: "Profile Interaction",
    requiredData: [],
  },
};

// ---------- helpers ----------

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandomFillers(mainTaskKey, count) {
  const available = Object.keys(FILLER_STEPS).filter((k) => k !== mainTaskKey);
  const shuffled = [...available].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      parsed[args[i].replace("--", "")] = args[i + 1] || true;
      i += 1;
    }
  }
  return parsed;
}

// ---------- run one profile (same logic as single-profile.js) ----------

async function runOneProfile(profileUuid, mainTaskKey, taskData, profileIndex) {
  const tag = `[profile-${profileIndex + 1}:${profileUuid.slice(-8)}]`;
  const mainTask = MAIN_TASKS[mainTaskKey];

  console.log(`${tag} Opening profile...`);
  const session = await openProfile(profileUuid);
  const page =
    session.context.pages().find((p) => p.url() !== "about:blank") ||
    session.context.pages()[0] ||
    (await session.context.newPage());

  console.log(`${tag} Attached to: ${page.url() || "about:blank"}`);

  try {
    // --- random filler(s) before ---
    const beforeSteps = pickRandomFillers(mainTaskKey, randomInt(1, 2));
    for (const stepKey of beforeSteps) {
      console.log(`${tag} Filler: ${FILLER_STEPS[stepKey].label}`);
      await FILLER_STEPS[stepKey].module(page, null);
      await sleep(randomInt(3000, 8000));
    }

    // --- main task ---
    console.log(`${tag} Main task: ${mainTask.label}`);
    await mainTask.module(page, taskData);
    await sleep(randomInt(3000, 8000));

    // --- random filler(s) after ---
    const afterSteps = pickRandomFillers(mainTaskKey, randomInt(1, 2));
    for (const stepKey of afterSteps) {
      console.log(`${tag} Filler: ${FILLER_STEPS[stepKey].label}`);
      await FILLER_STEPS[stepKey].module(page, null);
      await sleep(randomInt(3000, 8000));
    }

    console.log(`${tag} Done.`);
  } catch (err) {
    console.error(`${tag} Error: ${err.message}`);
  } finally {
    await closeProfile(profileUuid, session.browser);
    console.log(`${tag} Profile closed.`);
  }
}

// ---------- main ----------

async function main() {
  const args = parseArgs();

  const uuids = (args.uuids || "").split(",").filter(Boolean);
  const mainTaskKey = args.task || "homepage_interaction";
  const maxConcurrent = parseInt(args.concurrency || "5", 10);

  if (uuids.length === 0) {
    console.error(
      "Usage: node multi-profile.js --uuids uuid1,uuid2,... --task <task> [--url <url>]",
    );
    process.exit(1);
  }

  if (!MAIN_TASKS[mainTaskKey]) {
    console.error(
      `Unknown task: "${mainTaskKey}". Available: ${Object.keys(MAIN_TASKS).join(", ")}`,
    );
    process.exit(1);
  }

  const taskData = {
    url: args.url || null,
    message: args.message || null,
  };

  console.log(`[multi] Profiles: ${uuids.length}`);
  console.log(`[multi] Task: ${mainTaskKey}`);
  console.log(`[multi] Max concurrent: ${maxConcurrent}`);
  if (taskData.url) console.log(`[multi] URL: ${taskData.url}`);

  // staggered parallel execution with concurrency limit
  const running = new Set();
  const queue = [...uuids];
  let index = 0;

  async function startNext() {
    if (queue.length === 0) return;

    const uuid = queue.shift();
    const currentIndex = index;
    index += 1;

    // stagger: each profile starts 5-15s after the previous one
    if (currentIndex > 0) {
      const staggerMs = randomInt(5000, 15000);
      console.log(
        `[multi] Staggering profile ${currentIndex + 1} by ${(staggerMs / 1000).toFixed(1)}s...`,
      );
      await sleep(staggerMs);
    }

    const promise = runOneProfile(uuid, mainTaskKey, taskData, currentIndex);
    running.add(promise);

    promise.finally(() => {
      running.delete(promise);
      startNext(); // fill the slot
    });
  }

  // start up to maxConcurrent profiles
  const initialBatch = Math.min(maxConcurrent, queue.length);
  for (let i = 0; i < initialBatch; i += 1) {
    startNext();
  }

  // wait for all to complete
  while (running.size > 0) {
    await Promise.race(running);
  }

  console.log("\n[multi] All profiles complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exitCode = 1;
});
