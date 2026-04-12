// steps/utils/scroll-utils.js
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function smoothScrollBy(page, distance, options = {}) {
  const stepMinPx = options.stepMinPx ?? 18;
  const stepMaxPx = options.stepMaxPx ?? 40;
  const stepDelayMinMs = options.stepDelayMinMs ?? 16;
  const stepDelayMaxMs = options.stepDelayMaxMs ?? 40;

  let remaining = distance;
  while (remaining > 0) {
    const step = Math.min(remaining, randomInt(stepMinPx, stepMaxPx));
    await page.mouse.wheel(0, step);
    remaining -= step;
    await page.waitForTimeout(randomInt(stepDelayMinMs, stepDelayMaxMs));
  }
}

async function scrollForDuration(page, durationMs, options = {}) {
  const chunkMinPx = options.chunkMinPx ?? 220;
  const chunkMaxPx = options.chunkMaxPx ?? 600;
  const chunkPauseMinMs = options.chunkPauseMinMs ?? 100;
  const chunkPauseMaxMs = options.chunkPauseMaxMs ?? 260;

  const endTime = Date.now() + durationMs;
  while (Date.now() < endTime) {
    await smoothScrollBy(page, randomInt(chunkMinPx, chunkMaxPx), options);

    const remainingMs = endTime - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await page.waitForTimeout(
      Math.min(remainingMs, randomInt(chunkPauseMinMs, chunkPauseMaxMs)),
    );
  }
}

module.exports = {
  randomInt,
  smoothScrollBy,
  scrollForDuration,
};
