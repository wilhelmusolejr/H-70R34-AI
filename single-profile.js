// single-profile.js
const { openProfile, closeProfile } = require("./hidemium");
const runTestScript = require("./steps/test-script");
const runFacebookHomepageInteraction = require("./steps/facebook-homepage-interaction");
const runAddingFriendStep = require("./steps/adding-friend-step");
const runProfileInteraction = require("./steps/profile-interaction");

const PROFILE_UUID = "local-cb754975-1f0f-49d9-a6ea-ae56b6175dd0";
const KEEP_PROFILE_OPEN = true;
const REUSE_CURRENT_TAB = true;
const START_URL = "https://www.facebook.com/";
const OPEN_START_URL_WHEN_BLANK = true;
const STEP_KEY = process.env.STEP_KEY || "facebook_homepage_interaction";

const STEP_RUNNERS = {
  test_script: runTestScript,
  facebook_homepage_interaction: runFacebookHomepageInteraction,
  adding_friend: runAddingFriendStep,
  profile_interaction: runProfileInteraction,
};

async function getWorkingPage(context) {
  const pages = context.pages();

  if (pages.length === 0) {
    return context.newPage();
  }

  if (!REUSE_CURRENT_TAB) {
    return pages[0];
  }

  // Reuse any non-blank page so we can test against current browser state.
  const nonBlankPage = pages.find((p) => p.url() && p.url() !== "about:blank");
  return nonBlankPage || pages[0];
}

async function ensureStartPage(page) {
  const currentUrl = page.url() || "about:blank";

  if (!OPEN_START_URL_WHEN_BLANK || currentUrl !== "about:blank") {
    return;
  }

  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
  console.log(`Opened start URL: ${START_URL}`);
}

async function run() {
  let browser;
  const shouldCloseProfile = !KEEP_PROFILE_OPEN;
  const runStep = STEP_RUNNERS[STEP_KEY];

  if (!runStep) {
    throw new Error(
      `Unknown STEP_KEY "${STEP_KEY}". Available: ${Object.keys(STEP_RUNNERS).join(", ")}`,
    );
  }

  try {
    const session = await openProfile(PROFILE_UUID);
    browser = session.browser;

    const page = await getWorkingPage(session.context);
    await ensureStartPage(page);
    console.log(`Using current tab: ${page.url() || "about:blank"}`);

    console.log(`Running step: ${STEP_KEY}`);
    await runStep(page);
  } finally {
    if (shouldCloseProfile) {
      await closeProfile(PROFILE_UUID, browser);
      console.log("Profile closed");
      return;
    }

    // Dev mode: keep profile/browser open across runs for fast iteration.
    console.log("Development mode: profile left open for reuse.");
  }
}

run().catch((error) => {
  console.error("Automation failed:", error);
  process.exitCode = 1;
});
