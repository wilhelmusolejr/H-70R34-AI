// generate-share-message.js
//
// Calls the GitHub Models API (OpenAI-compatible) to generate a Facebook
// share post message based on the user's identity and the post context.
//
// Usage:
//   const { generateShareMessage } = require("./utils/generate-share-message");
//   const message = await generateShareMessage(userIdentity, postContext);
//
// Required env var:
//   GITHUB_TOKEN — your GitHub personal access token with Models access
//
// Returns:
//   A plain string — the share message only, ready to be typed into the
//   Facebook share dialog. Empty string on failure (share proceeds silently).

const OpenAI = require("openai");

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
const MODEL = "gpt-4o-mini";

async function generateShareMessage(userIdentity, postContext) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      "[generate-share-message] GITHUB_TOKEN not set, returning empty message.",
    );
    return "";
  }

  const client = new OpenAI({
    baseURL: GITHUB_MODELS_BASE_URL,
    apiKey: token,
  });

  const systemPrompt = `You are ${userIdentity}. Write a short, natural Facebook share message for the post described below. Return only the message text — no quotes, no explanation, no hashtags unless they feel natural for this person.`;

  const userPrompt = `Post context:\n${postContext}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 100,
    });

    const message = response.choices[0]?.message?.content?.trim() ?? "";
    console.log(`[generate-share-message] Generated: "${message}"`);
    return message;
  } catch (err) {
    console.warn(`[generate-share-message] API error: ${err.message}`);
    return "";
  }
}

module.exports = { generateShareMessage };
