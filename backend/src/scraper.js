/**
 * SCRAPER MODULE
 * ---------------------------------------------------
 * Scrapes one product's price/stock from the INE mock store.
 *
 * Key things this store requires (found through real debugging, not
 * assumption):
 * 1. A cookie consent overlay appears often and can block clicks --
 *    dismissed via ACCEPT/DECLINE button text, falling back to removing
 *    it directly if neither appears.
 * 2. The price does NOT load on page open. It requires a click-and-drag
 *    "scratch" motion across the price block (like a scratch card), then
 *    clicking a "Reveal price" button that starts disabled and needs its
 *    disabled attribute force-removed.
 * 3. The real price element's tag/class hash varies per load (sometimes
 *    <output>, sometimes <span>, with a random class suffix) -- so we
 *    match on a stable partial class ("pv-", "mr-") rather than a full
 *    class name or specific tag.
 * 4. Even after class="price-success" appears, the number can still be
 *    mid-animation (an "Updating…" label, reduced opacity) -- we wait for
 *    that to clear before trusting the value.
 * 5. The price text can contain zero-width spaces and uses a dot as a
 *    THOUSANDS separator in some renders (e.g. "1.970" means 1970, not
 *    1.97) -- parsePrice below specifically guards against both.
 *
 * Returns a result object; NEVER throws for "the store failed" -- that's
 * a normal, expected outcome (status: 'failed') the caller logs honestly.
 * Only throws for genuine infrastructure problems (e.g. browser failed to
 * launch), which scrapeProduct still catches so it can never crash the
 * server.
 */
const { chromium } = require('playwright');

const SELECTORS = {
  block: '.price-block',
  price: '.price-main [class*="pv-"]',
  original: '.price-main [class*="mr-"]',
  stock: '.price-block .stock-badge',
};

const MAX_RETRIES = 5; // for the real deployed cron job (runs unattended
// every 2h, speed doesn't matter) you can raise this to 8-10 for extra
// persistence if you want a higher success rate.
const RETRY_DELAY = 2000;
const NAV_TIMEOUT_MS = 15000;
const ELEMENT_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Parses a raw price string into a clean number. Guards against:
 * - zero-width spaces hidden in the text
 * - a dot/comma used as a THOUSANDS separator (e.g. "1.970" meaning 1970,
 *   not 1.97) -- a naive strip-non-digits parse would misread this badly.
 */
function parsePrice(text) {
  if (!text) return null;

  let clean = text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // strip zero-width spaces
    .replace(/[^0-9.,]/g, '');

  const decimal = clean.match(/[,.](\d{2})$/);
  let suffix = '';
  if (decimal) {
    suffix = '.' + decimal[1];
    clean = clean.slice(0, -3);
  }

  clean = clean.replace(/[,.]/g, ''); // remaining separators are thousands groupings

  const value = parseFloat(clean + suffix);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses stock text like "17 in stock" / "Hurry, just 5 left" / "Out of stock".
 */
function parseStock(text) {
  if (!text) return { raw: null, count: null, inStock: null };

  const raw = text.trim();
  const lower = raw.toLowerCase();
  const match = raw.match(/\d+/);

  return {
    raw,
    count: match ? parseInt(match[0], 10) : null,
    inStock: lower.includes('out of stock') ? false : lower.includes('stock') || lower.includes('left') ? true : null,
  };
}

/**
 * Dismisses the cookie consent overlay if present. Tries a real
 * ACCEPT/DECLINE button by role/text (up to 3 times, since it can need
 * more than one click), then removes it directly as a fallback so it can
 * never block a later click.
 */
async function dismissCookieOverlay(page) {
  for (let i = 0; i < 3; i++) {
    const accept = page.getByRole('button', { name: /ACCEPT/i }).first();
    const decline = page.getByRole('button', { name: /DECLINE/i }).first();
    try {
      await accept.click({ timeout: 1000 });
      continue;
    } catch {
      try {
        await decline.click({ timeout: 1000 });
        continue;
      } catch {
        break;
      }
    }
  }
  await page.evaluate(() => document.querySelector('.cookie-overlay')?.remove()).catch(() => {});
}

/**
 * Performs the click-and-drag "scratch" motion across the price block,
 * then force-clicks the reveal button. Retries up to 3 times within one
 * attempt if the block doesn't visibly leave "price-idle" -- testing
 * showed the interaction doesn't always register on the first try even
 * though the mechanism itself is correct.
 */
async function revealPrice(page) {
  for (let clickTry = 1; clickTry <= 3; clickTry++) {
    const block = page.locator(SELECTORS.block).first();
    await block.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const box = await block.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      for (let i = 0; i < 5; i++) {
        await page.mouse.move(box.x + box.width - 10, box.y + 10 + i * 5, { steps: 5 });
        await page.mouse.move(box.x + 10, box.y + 15 + i * 5, { steps: 5 });
      }
      await page.mouse.up();
    }

    try {
      const button = page.locator('.price-block button').first();
      await button.waitFor({ state: 'visible', timeout: 3000 });
      await page.evaluate(() => document.querySelector('.price-block button')?.removeAttribute('disabled'));
      await button.click({ force: true, timeout: 2000 });
    } catch {
      // no visible/clickable button this round -- fall through and check state anyway
    }

    await page.waitForTimeout(800);
    const stillIdle = await page
      .locator(SELECTORS.block)
      .first()
      .evaluate((el) => /price-idle/.test(el.className))
      .catch(() => true);
    if (!stillIdle) return; // reveal triggered -- stop retrying
  }
}

async function attemptScrape(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    await dismissCookieOverlay(page);
    await revealPrice(page);

    const result = await page.waitForFunction(
      ({ block, price }) => {
        const el = document.querySelector(block);
        const priceEl = document.querySelector(price);
        const className = el ? el.className : '';

        if (/price-error/.test(className)) {
          const status = document.querySelector('.price-status');
          const substatus = document.querySelector('.price-substatus');
          return {
            done: true,
            failed: true,
            reason: status ? status.textContent.trim() : 'Price loading failed',
            substatus: substatus ? substatus.textContent.trim() : null,
          };
        }

        if (/price-success/.test(className) && priceEl && priceEl.textContent.trim()) {
          return { done: true, failed: false };
        }

        return false;
      },
      { block: SELECTORS.block, price: SELECTORS.price },
      { timeout: ELEMENT_TIMEOUT_MS }
    );

    const outcome = await result.jsonValue();

    if (outcome.failed) {
      throw new Error(`${outcome.reason}${outcome.substatus ? ` (${outcome.substatus})` : ''}`);
    }

    const priceText = await page.locator(SELECTORS.price).first().innerText();
    const price = parsePrice(priceText);
    if (price === null) {
      throw new Error(`Could not parse a valid price from text: "${priceText}"`);
    }

    let originalText = null;
    try {
      originalText = await page.locator(SELECTORS.original).first().innerText({ timeout: 2000 });
    } catch {}

    let stockText = null;
    try {
      stockText = await page.locator(SELECTORS.stock).first().innerText({ timeout: 2000 });
    } catch {}
    const stock = parseStock(stockText);

    return {
      status: 'success',
      price,
      originalPrice: parsePrice(originalText),
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
 * Public entry point: scrapes one product URL with retries. Launches its
 * own browser instance and always closes it, even on error. NEVER throws
 * for a normal scraping failure -- always resolves to a result object so
 * the caller can log it honestly.
 */
async function scrapeProduct(url) {
  if (!url) {
    return { status: 'failed', error: 'Product URL is required', attempts: 0, scrapedAt: new Date().toISOString() };
  }

  // IMPORTANT: newer Playwright versions use a separate, lightweight
  // "headless shell" binary for headless launches by default, which
  // needs its own install step that doesn't always trigger reliably on
  // Render's build environment. Forcing channel: 'chromium' makes it use
  // the regular Chromium binary instead (the one that reliably installs
  // via `npx playwright install chromium`), avoiding that extra binary
  // entirely.
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    // Render's free tier has a hard 512MB memory cap. These flags reduce
    // Chromium's memory/resource footprint significantly -- especially
    // --disable-dev-shm-usage, since containers often have a tiny
    // /dev/shm that Chromium would otherwise hit and behave badly on.
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
    ],
  });

  try {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Scraping attempt ${attempt}/${MAX_RETRIES}`);
        const result = await attemptScrape(browser, url);
        return { ...result, status: attempt === 1 ? 'success' : 'retried', attempts: attempt };
      } catch (error) {
        lastError = error;
        console.log(`Attempt ${attempt} failed: ${error.message}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY * attempt);
        }
      }
    }

    return {
      status: 'failed',
      price: null,
      error: lastError ? lastError.message : 'Scraping failed',
      attempts: MAX_RETRIES,
      scrapedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeProduct };