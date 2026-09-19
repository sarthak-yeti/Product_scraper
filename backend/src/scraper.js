/**
 * SCRAPER MODULE
 * ---------------------------------------------------
 * Same logic you already tested in the standalone scrape.js, just packaged
 * as a function the Express server can call. Returns a result object; it
 * NEVER throws for a "the store failed" case -- that's a normal, expected
 * outcome (status: 'failed') that the caller logs honestly. It only throws
 * for genuine infrastructure problems (e.g. browser failed to launch).
 */
const { chromium } = require('playwright');

const SELECTORS = {
  priceBlock: '.price-block',
  priceValue: '.price-block .price-main output',
  originalPrice: '.price-block .price-main .mr-m4',
  stock: '.price-block .stock-badge',
};

const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 2500;
const NAV_TIMEOUT_MS = 15000;
const ELEMENT_TIMEOUT_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePrice(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseStock(rawText) {
  if (!rawText) return { inStock: null, count: null, raw: null };
  const raw = rawText.trim();
  const lower = raw.toLowerCase();
  const inStock = lower.includes('out of stock') ? false : lower.includes('stock') || lower.includes('left') ? true : null;
  const match = raw.match(/(\d+)/);
  const count = match ? parseInt(match[1], 10) : null;
  return { inStock, count, raw };
}

async function attemptScrape(browser, url) {
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    const outcome = await page
      .waitForFunction(
        ({ blockSelector, priceSelector }) => {
          const block = document.querySelector(blockSelector);
          const className = block ? block.className : '';
          if (/price-error/.test(className)) {
            const status = document.querySelector('.price-status');
            const substatus = document.querySelector('.price-substatus');
            return {
              done: true,
              failed: true,
              reason: status ? status.textContent.trim() : 'price-error state',
              substatus: substatus ? substatus.textContent.trim() : null,
            };
          }
          const priceEl = document.querySelector(priceSelector);
          if (/price-success/.test(className) && priceEl && priceEl.textContent.trim().length > 0) {
            return { done: true, failed: false };
          }
          return false;
        },
        { blockSelector: SELECTORS.priceBlock, priceSelector: SELECTORS.priceValue },
        { timeout: ELEMENT_TIMEOUT_MS }
      )
      .then((handle) => handle.jsonValue());

    if (outcome.failed) {
      throw new Error(
        `Store reported a price load failure: "${outcome.reason}"${outcome.substatus ? ` (${outcome.substatus})` : ''}`
      );
    }

    const priceText = await page.locator(SELECTORS.priceValue).first().innerText();
    const price = parsePrice(priceText);

    let stockText = null;
    try {
      stockText = await page.locator(SELECTORS.stock).first().innerText({ timeout: 3000 });
    } catch {
      stockText = null;
    }
    const stock = parseStock(stockText);

    let originalPriceText = null;
    try {
      originalPriceText = await page.locator(SELECTORS.originalPrice).first().innerText({ timeout: 2000 });
    } catch {
      originalPriceText = null;
    }

    if (price === null) {
      throw new Error(`Could not parse a valid price from text: "${priceText}"`);
    }

    return {
      status: 'success',
      price,
      originalPrice: parsePrice(originalPriceText),
      stockText: stock.raw,
      stockCount: stock.count,
      inStock: stock.inStock,
      rawPriceText: priceText.trim(),
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}

async function scrapeWithRetries(browser, url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await attemptScrape(browser, url);
      return { ...result, status: attempt === 1 ? 'success' : 'retried', attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  return {
    status: 'failed',
    price: null,
    error: lastError ? lastError.message : 'Unknown error',
    scrapedAt: new Date().toISOString(),
    attempts: MAX_RETRIES,
  };
}

/**
 * Public entry point: scrapes one product URL and returns the result.
 * Launches its own browser instance and always closes it, even on error.
 */
async function scrapeProduct(url) {
  const browser = await chromium.launch({
    headless: true, // server-side / cron use -- always headless
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    return await scrapeWithRetries(browser, url);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeProduct };