// TODO: Replace with your own list of target profile URLs
const PROFILE_URLS = [
  "https://web.facebook.com/brendan.eich.967383",
  "https://web.facebook.com/profile.php?id=61580634357759",
  "https://web.facebook.com/earldavid.asuncion",
];

function getRandomProfileUrl() {
  return PROFILE_URLS[Math.floor(Math.random() * PROFILE_URLS.length)];
}

module.exports = { PROFILE_URLS, getRandomProfileUrl };
