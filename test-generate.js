// test-generate.js
const { generateShareMessage } = require("./steps/utils/generate-share-message");

(async () => {
  const message = await generateShareMessage(
    "a regular Facebook user who enjoys sharing interesting posts",
    "a post from my Facebook feed",
  );

  console.log("Result:", message);
})();
