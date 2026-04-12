// setup.js — run this once after cloning on a new machine
// Usage: node setup.js

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function log(msg) {
  console.log(`[setup] ${msg}`);
}

function ok(msg) {
  console.log(`[setup] ✓ ${msg}`);
}

function warn(msg) {
  console.log(`[setup] ⚠ ${msg}`);
}

function fail(msg) {
  console.error(`[setup] ✗ ${msg}`);
}

// 1. Check Node version
const nodeVersion = process.versions.node;
const major = parseInt(nodeVersion.split(".")[0], 10);
if (major < 18) {
  fail(`Node.js 18+ required. You have v${nodeVersion}. Download from https://nodejs.org`);
  process.exit(1);
}
ok(`Node.js v${nodeVersion}`);

// 2. Install npm dependencies
log("Installing npm dependencies...");
try {
  execSync("npm install", { stdio: "inherit" });
  ok("npm dependencies installed");
} catch {
  fail("npm install failed. Make sure Node.js and npm are installed.");
  process.exit(1);
}

// 3. Check .env file
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  ok(".env file found");
} else {
  warn(".env file missing — create one in the project root with:");
  console.log(`
  GITHUB_TOKEN=your_github_token_here
  GITHUB_MODELS_MODEL=openai/gpt-4.1
`);
}

// 4. Check required env vars (if .env exists)
if (fs.existsSync(envPath)) {
  require("dotenv").config();
  const missing = [];
  if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_MODELS_TOKEN) {
    missing.push("GITHUB_TOKEN");
  }
  if (!process.env.GITHUB_MODELS_MODEL) {
    warn("GITHUB_MODELS_MODEL not set — will default to openai/gpt-4.1");
  }
  if (missing.length > 0) {
    warn(`Missing in .env: ${missing.join(", ")}`);
  } else {
    ok("Environment variables look good");
  }
}

// 5. Remind about Hidemium token
warn("Remember to paste your Hidemium API token into hidemium.js (API_TOKEN)");
warn("Remember to update PROFILE_UUIDS in scheduler.js with this machine's profile UUIDs");

console.log("\n[setup] Setup complete. You can now run: node scheduler.js\n");
