// TODO: Replace with your own list of target profile URLs
const PROFILE_URLS = [
  "https://www.facebook.com/zuck",
  "https://www.facebook.com/leahpearlman",
  "https://www.facebook.com/baboross.official",
  // add more profiles here — public pages and profiles that are safe to visit
];

function getRandomProfileUrl() {
  return PROFILE_URLS[Math.floor(Math.random() * PROFILE_URLS.length)];
}

module.exports = { PROFILE_URLS, getRandomProfileUrl };
