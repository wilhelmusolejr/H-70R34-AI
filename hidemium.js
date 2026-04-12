// hidemium.js — Reusable helper module
const axios = require("axios");
const { chromium } = require("playwright");

const API = "http://127.0.0.1:2222";
const API_TOKEN = "pMgajBtFminGid3d6Wh0zFu2gPGx3BhUt3KX0S"; // <-- paste your token from Hidemium Settings > Generate token

const headers = { Authorization: `Bearer ${API_TOKEN}` };

async function openProfile(uuid) {
  const { data } = await axios.get(`${API}/openProfile?uuid=${uuid}`, {
    headers,
  });
  if (data.status !== "successfully") {
    throw new Error(`Failed to open ${uuid}: ${JSON.stringify(data)}`);
  }
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${data.data.remote_port}`,
  );
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.newPage());
  return { browser, context, page, port: data.data.remote_port };
}

async function closeProfile(uuid, browser) {
  if (browser) await browser.close().catch(() => {});
  await axios
    .get(`${API}/closeProfile?uuid=${uuid}`, { headers })
    .catch(() => {});
}

async function listProfiles() {
  const { data } = await axios.get(`${API}/profiles`, { headers });
  return data.data || [];
}

module.exports = { openProfile, closeProfile, listProfiles };
