// steps/utils/scroll-utils.js
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function humanScrollTo(page, targetPageY) {
  const viewport = await page.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
  }));

  const desiredScrollY = Math.max(0, targetPageY - viewport.innerHeight / 2);
  let distance = desiredScrollY - viewport.scrollY;

  if (Math.abs(distance) < 10) return;

  const direction = distance > 0 ? 1 : -1;
  let remaining = Math.abs(distance);

  while (remaining > 0) {
    const chunk = Math.min(remaining, randomInt(220, 500));
    let stepped = 0;

    while (stepped < chunk) {
      const step = Math.min(chunk - stepped, randomInt(18, 40));
      await page.mouse.wheel(0, step * direction);
      stepped += step;
      await page.waitForTimeout(randomInt(16, 40));
    }

    remaining -= chunk;
    if (remaining > 0) {
      await page.waitForTimeout(randomInt(100, 260));
    }
  }

  await page.waitForTimeout(randomInt(200, 400));
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
  shuffle,
  sleep,
  humanScrollTo,
  smoothScrollBy,
  scrollForDuration,
};
