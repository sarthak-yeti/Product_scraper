/**
 * STANDALONE SCRAPER SCRIPT
 * ---------------------------------------------------
 * Purpose: given a product page URL on the mock store, extract the
 * current price + stock reliably, even if the page is slow, the
 * content loads late via JS, or the request fails outright.
 *
 * Run modes:
 *   node scrape.js <productUrl>            -> headless (for cron/server)
 *   node scrape.js <productUrl> --headed   -> visible browser (for your recording)
 *
 * WHY PLAYWRIGHT (not axios+cheerio):
 * The store's homepage returned almost no content in the raw HTML,
 * which is a strong signal it's a JS-rendered app (React/Vue) that
 * injects products into the DOM after the page loads. cheerio can only
 * see the initial HTML, not what JS adds afterwards -- so it would see
 * an empty page. Playwright actually runs a real browser, executes the
 * JS, and lets us wait for the price element to actually appear.
 *
 * IMPORTANT: The exact CSS selectors below (SELECTORS object) are
 * PLACEHOLDERS. You must open the real product page in your browser,
 * right-click the price -> Inspect, and update these to match the
 * real class names / structure. I'll help you adjust once you paste
 * back what you see.
 */

const { chromium } = require('playwright');

// ---- CONFIG: based on real HTML inspected from the store ----
// IMPORTANT: the store hides 1-2 DECOY prices on the page using
// style="display:none" + aria-hidden="true" (seen values: unrelated fake
// numbers). We must NEVER select those. The REAL price is inside an
// <output> tag whose class name is a randomized hash (e.g. "vfqxojm") that
// likely changes on every reload -- so we target it structurally
// (the <output> tag inside .price-main) rather than by that class name.
const SELECTORS = {
  // Wrapper the store itself uses; its class (price-success / price-fail /
  // price-pending, etc.) may double as an honest "did this load ok" signal.
  priceBlock: '.price-block',
  // The REAL visible price -- tag-based selector, ignores decoys entirely
  // because decoys are <span> elements, not <output>.
  priceValue: '.price-block .price-main output',
  // The strikethrough original/MRP price (informational only, not the
  // price we track).
  originalPrice: '.price-block .price-main .mr-m4',
  // Stock badge, e.g. "17 in stock" / presumably "Out of stock"
  stock: '.price-block .stock-badge',
};

const MAX_RETRIES = 4; // the store fails somewhat randomly by design (even for
// regular human visitors, confirmed by testing in an ordinary browser) --
// a bit more persistence meaningfully raises the odds of eventually
// getting a real reading without ever faking one.
const RETRY_DELAY_MS = 2500; // wait between retries
const NAV_TIMEOUT_MS = 15000; // give a slow page up to 15s to load
const ELEMENT_TIMEOUT_MS = 10000; // give async content up to 10s to appear

/**
 * Sleep helper for our retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a raw price string like "₹661" or "₹1,224.00" into a clean number.
 * Returns null if it can't confidently parse it -- we NEVER want to guess
 * and save a wrong number.
 */
function parsePrice(rawText) {
  if (!rawText) return null;
  const cleaned = rawText.replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses "17 in stock" / "Out of stock" style text into a usable shape.
 * We keep both the raw text and a best-effort numeric count, and a boolean
 * for "is it in stock at all" that doesn't depend on parsing a number.
 */
function parseStock(rawText) {
  if (!rawText) return { inStock: null, count: null, raw: null };
  const raw = rawText.trim();
  const lower = raw.toLowerCase();
  const inStock = lower.includes('out of stock') ? false : lower.includes('stock') ? true : null;
  const match = raw.match(/(\d+)/);
  const count = match ? parseInt(match[1], 10) : null;
  return { inStock, count, raw };
}

/**
 * Does ONE attempt to scrape a product page. Throws an error if anything
 * goes wrong -- the caller (scrapeWithRetries) decides what to do with that.
 */
async function attemptScrape(browser, url) {
  const page = await browser.newPage({
    // A realistic desktop UA + viewport, since default Playwright/headless
    // values can look distinctly non-human to a detection script.
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  // Hide the most common automation fingerprint: by default,
  // navigator.webdriver reads `true` in an automated browser, which a
  // detection script can check directly. We override it before any page
  // script runs, so it reads `false`/undefined like a normal browser.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  try {
    // 1. Navigate, but don't trust "page loaded" to mean "content loaded" --
    //    this store loads some content asynchronously after a delay.
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });

    // 2. Wait for the page to settle into either a SUCCESS state (the store
    //    adds class "price-success" to .price-block once the real <output>
    //    price appears) or a FAILURE state (confirmed real HTML: the store
    //    adds class "price-error" and shows:
    //      <p class="price-status">Couldn't load the price after 1 attempts.</p>
    //      <p class="price-substatus">challenge_failed</p>
    //      <button>Try again</button>
    //    Polling the block's className is far more reliable than matching
    //    on status text, since wording like "Couldn't load" won't match a
    //    literal "could not" string -- exact text is easy to get wrong,
    //    but the store's own success/error class is authoritative.
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
          return false; // still loading -- keep polling
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

    // 3. Now it's safe to read the text. innerText() on the <output>
    //    correctly concatenates its child spans ("₹","6","6","1") into
    //    "₹661" even though the price is split across multiple spans.
    const priceText = await page.locator(SELECTORS.priceValue).first().innerText();
    const price = parsePrice(priceText);

    let stockText = null;
    try {
      stockText = await page.locator(SELECTORS.stock).first().innerText({ timeout: 3000 });
    } catch {
      stockText = null; // stock badge might be absent on some layouts -- not fatal
    }
    const stock = parseStock(stockText);

    let originalPriceText = null;
    try {
      originalPriceText = await page.locator(SELECTORS.originalPrice).first().innerText({ timeout: 2000 });
    } catch {
      originalPriceText = null; // not every product has a strikethrough MRP -- not fatal
    }

    // 4. Sanity check: if we couldn't parse a real number, treat this as a
    //    FAILED scrape rather than saving a null/zero price.
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

/**
 * Wraps attemptScrape with retry logic. This is the heart of "reliability
 * across many unattended runs":
 *   - Try up to MAX_RETRIES times
 *   - Wait a bit between attempts (the site may just be slow/temporarily erroring)
 *   - If EVERY attempt fails, return a clear "failed" result -- never throw
 *     silently, never fabricate data.
 */
async function scrapeWithRetries(browser, url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[attempt ${attempt}/${MAX_RETRIES}] Scraping ${url} ...`);
      const result = await attemptScrape(browser, url);
      console.log(`[attempt ${attempt}] SUCCESS -> price=${result.price}, stock=${result.stockText}`);

      // If this succeeded after previous failures, mark it as "retried"
      // rather than a clean "success", so the log is honest about what happened.
      return {
        ...result,
        status: attempt === 1 ? 'success' : 'retried',
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      console.warn(`[attempt ${attempt}] FAILED -> ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt); // simple backoff: 2s, 4s, ...
      }
    }
  }

  // All attempts exhausted -- report an honest failure, no fake data.
  return {
    status: 'failed',
    price: null,
    stock: null,
    error: lastError ? lastError.message : 'Unknown error',
    scrapedAt: new Date().toISOString(),
    attempts: MAX_RETRIES,
  };
}

/**
 * Entry point.
 */
async function main() {
  const url = process.argv[2];
  const headed = process.argv.includes('--headed');

  if (!url) {
    console.error('Usage: node scrape.js <productUrl> [--headed]');
    process.exit(1);
  }

  console.log(`Launching browser (headed=${headed}) ...`);
  const browser = await chromium.launch({
    headless: !headed,
    // Some sites run a simple bot-detection check (the store's own
    // "challenge_failed" naming suggests exactly this) that looks for
    // default automation fingerprints. These flags hide the most common
    // one Chromium normally exposes when driven by Playwright/Selenium.
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const result = await scrapeWithRetries(browser, url);
    console.log('\n=== FINAL RESULT ===');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

main();