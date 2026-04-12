// generate-share-message.js
//
// Calls the GitHub Models API to generate a Facebook share post message
// based on the user's identity and the post context.
//
// Usage:
//   const { generateShareMessage } = require("./utils/generate-share-message");
//   const message = await generateShareMessage(userIdentity, postContext);
//
// Required env vars:
//   GITHUB_MODELS_TOKEN        - GitHub personal access token with Models access
//   GITHUB_MODELS_MODEL        - model name (default: openai/gpt-4.1)
//   GITHUB_MODELS_BASE_URL     - API endpoint (default: https://models.github.ai/inference/chat/completions)
//   GITHUB_MODELS_API_VERSION  - API version header (default: 2026-03-10)
//
// Returns:
//   A plain string - the share message only, ready to be typed into the
//   Facebook share dialog. Empty string on failure (share proceeds silently).

require("dotenv").config();

async function requestGitHubModels(messages, options = {}) {
  const token = String(
    process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN || "",
  ).trim();
  const model = String(
    process.env.GITHUB_MODELS_MODEL || "openai/gpt-4.1",
  ).trim();
  const endpoint = String(
    process.env.GITHUB_MODELS_BASE_URL ||
      "https://models.github.ai/inference/chat/completions",
  ).trim();
  const apiVersion = String(
    process.env.GITHUB_MODELS_API_VERSION || "2026-03-10",
  ).trim();

  if (!token) {
    throw new Error("Missing GITHUB_MODELS_TOKEN in environment.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": apiVersion,
    },
    body: JSON.stringify({
      model,
      temperature: options.temperature ?? 0.8,
      max_tokens: options.maxTokens ?? 100,
      messages,
    }),
  });

  if (!response.ok) {
    let errorMessage = "GitHub Models request failed.";
    try {
      const body = await response.json();
      errorMessage = body?.message || body?.error?.message || errorMessage;
    } catch {
      // ignore body parse failures
    }
    throw new Error(errorMessage);
  }

  return {
    model,
    payload: await response.json(),
  };
}

async function generateShareMessage(userIdentity, postContext) {
  try {
    const systemPrompt = `You are ${userIdentity}. Write a short, natural Facebook share message for the post described below. It should sound casual and human, not polished or AI-written. Avoid em dashes, long hyphens used like em dashes, corporate phrasing, and overly perfect grammar. Prefer simple everyday wording. Return only the message text, with no quotes, no explanation, and no hashtags unless they feel natural for this person.`;

    const { payload } = await requestGitHubModels([
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `Post context:\n${postContext}`,
      },
    ]);

    const message = payload.choices[0]?.message?.content?.trim() ?? "";
    console.log(`[generate-share-message] Generated: "${message}"`);
    return message;
  } catch (err) {
    console.warn(`[generate-share-message] API error: ${err.message}`);
    return "";
  }
}

module.exports = { generateShareMessage };
