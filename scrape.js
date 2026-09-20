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
  priceValue: '.price-main [class*="pv-"]', // tag-agnostic: sometimes an
  // <output>, sometimes a <span> -- both use a "pv-<hash>" class, so match
  // on that instead of assuming a specific tag.
  // The strikethrough original/MRP price (informational only, not the
  // price we track).
  originalPrice: '.price-main [class*="mr-"]', // per-load hash suffix varies (mr-a7, mr-m4, etc)
  // Stock badge, e.g. "17 in stock" / presumably "Out of stock"
  stock: '.price-block .stock-badge',
};

const MAX_RETRIES = getRetriesFromArgs() || 4; // the store fails somewhat
// randomly by design (even for regular human visitors, confirmed by
// testing in an ordinary browser) -- pass --retries=N on the command line
// to override for a one-off diagnostic run, e.g. --retries=20.
const RETRY_DELAY_MS = 2500; // wait between retries
const NAV_TIMEOUT_MS = 30000; // give a slow page up to 30s to load (generous for a diagnostic run)
const ELEMENT_TIMEOUT_MS = 25000; // give async content up to 25s to appear (generous for a diagnostic run)

function getRetriesFromArgs() {
  const arg = process.argv.find((a) => a.startsWith('--retries='));
  if (!arg) return null;
  const n = parseInt(arg.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Sleep helper for our retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses a raw price string into a clean number. Handles two traps a
 * reference implementation identified in this store's price text:
 * - zero-width spaces hidden in the text
 * - a dot used as a THOUSANDS separator (e.g. "1.970" meaning 1970, not
 *   1.97) -- a plain replace(/[^0-9.]/g,'') would misparse this badly.
 * We treat a trailing 2-digit group after a comma/dot as real decimals,
 * and treat any other dots/commas as thousands separators to strip.
 */
function parsePrice(rawText) {
  if (!rawText) return null;
  let clean = rawText.replace(/[\u200B-\u200D\uFEFF]/g, ''); // strip zero-width spaces
  clean = clean.replace(/[^0-9.,]/g, '');
  const decimalMatch = clean.match(/[,.](\d{2})$/);
  let decimal = '';
  if (decimalMatch) {
    decimal = '.' + decimalMatch[1];
    clean = clean.slice(0, -3);
  }
  clean = clean.replace(/[,.]/g, ''); // remaining separators are thousands groupings
  const value = parseFloat(clean + decimal);
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

  // THE REAL FIX: overriding the `userAgent` string above only changes the
  // legacy User-Agent header. It does NOT change Chromium's newer "Client
  // Hints" headers (sec-ch-ua etc), which real captured traffic showed
  // literally say `"HeadlessChrome";v="153"` even with --headless=new --
  // that's almost certainly what the server's /api/session check rejects
  // with 401. Override those headers directly on every request.
  await page.setExtraHTTPHeaders({
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="129", "Google Chrome";v="129"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });

  // DIAGNOSTIC: surface the page's own console output and any JS errors
  // directly in our terminal, so we can see what's actually happening
  // inside the page during a run instead of guessing blind.
  page.on('console', (msg) => console.log(`  [page console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`  [page error] ${err.message}`));
  page.on('requestfailed', (req) => console.log(`  [request failed] ${req.url()} -- ${req.failure()?.errorText}`));
  page.on('response', async (res) => {
    if (res.status() === 401 || /price|api/i.test(res.url())) {
      console.log(`  [response] ${res.status()} ${res.url()}`);
      const reqHeaders = res.request().headers();
      console.log(`  [request headers] ${JSON.stringify(reqHeaders, null, 2)}`);
    }
  });

  // A fuller stealth pass: headless Chromium leaves a few fingerprints
  // beyond navigator.webdriver (empty plugin list, missing window.chrome,
  // etc) that a detection script can check.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = window.chrome || { runtime: {} };
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    }
    // Headless Chromium renders WebGL via a software renderer
    // ("SwiftShader"), which is one of the most common ways sites detect
    // headless automation. Spoof it to report a normal-looking GPU.
    // Guarded: if WebGL isn't available at all in this environment,
    // skip rather than throw and silently break the rest of this script.
    if (typeof WebGLRenderingContext !== 'undefined') {
      const getParameterProto = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameterProto.call(this, parameter);
      };
    }
    // Headless/automated browser contexts can sometimes report different
    // pointer/hover capabilities than a normal desktop session (e.g.
    // reporting "coarse"/touch-like input). If the site gates its
    // hover-reveal feature behind a (hover: hover) / (pointer: fine)
    // media check, that could explain why our synthetic hover never
    // "counts" even though the mouse genuinely moves there. Force both
    // to report as a normal desktop mouse.
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (/hover/.test(query)) {
        return { matches: /hover:\s*hover/.test(query), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      }
      if (/pointer/.test(query)) {
        return { matches: /pointer:\s*fine/.test(query), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
      }
      return originalMatchMedia(query);
    };
  });
  try {
    // 1. Navigate, but don't trust "page loaded" to mean "content loaded" --
    //    this store loads some content asynchronously after a delay.
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });

    // The price-fetch request has been returning 401 Unauthorized when we
    // click "Reveal price" too soon after page load -- likely some
    // background setup request (an auth token/session cookie) hasn't
    // finished yet. Give the page a moment to settle before interacting.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // A cookie consent banner can sit on top of the page and intercept
    // clicks (confirmed via testing). A reference implementation that
    // works reliably against this store handles it by looking for
    // ACCEPT/DECLINE buttons by role/text and retrying up to 5 times
    // (the overlay can require more than one click to fully dismiss).
    for (let i = 0; i < 5; i++) {
      const acceptBtn = page.getByRole('button', { name: /ACCEPT/i }).first();
      const declineBtn = page.getByRole('button', { name: /DECLINE/i }).first();
      let clicked = false;
      try {
        await acceptBtn.waitFor({ state: 'visible', timeout: 3000 });
        await acceptBtn.click();
        clicked = true;
      } catch {
        try {
          await declineBtn.waitFor({ state: 'visible', timeout: 3000 });
          await declineBtn.click();
          clicked = true;
        } catch {
          // no visible cookie button this round
        }
      }
      if (clicked) {
        await page.waitForTimeout(300);
      } else {
        break;
      }
    }
    // Fallback safety net: if anything with this class is still present
    // (e.g. unexpected button wording), remove it directly so it can't
    // block later clicks.
    await page.evaluate(() => document.querySelector('.cookie-overlay')?.remove()).catch(() => {});

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
    // THE REAL FIX (found via a working reference implementation): the
    // price reveal isn't triggered by a simple hover -- it needs a
    // click-and-drag "scratch" motion across the price block (mouse down,
    // zigzag drag, release), like scratching a lottery ticket. Then force
    // the button's disabled attribute off directly and force-click it,
    // rather than waiting for it to become enabled naturally.
    // Retry the drag+click sequence itself up to 3 times if the block
    // doesn't move off "price-idle" -- testing showed the click doesn't
    // always register on the first try even though the mechanism works.
    for (let clickTry = 1; clickTry <= 3; clickTry++) {
      const priceBlockEl = page.locator(SELECTORS.priceBlock).first();
      await priceBlockEl.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);

      const box = await priceBlockEl.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + 10, box.y + 10);
        await page.mouse.down();
        for (let i = 0; i < 5; i++) {
          await page.mouse.move(box.x + box.width - 10, box.y + 10 + i * 5, { steps: 5 });
          await page.mouse.move(box.x + 10, box.y + 15 + i * 5, { steps: 5 });
        }
        await page.mouse.up();
      }

      const revealButton = page.locator('.price-block button').first();
      try {
        await page.waitForSelector('.price-block button', { timeout: 3000 });
        await page
          .waitForFunction(() => {
            const b = document.querySelector('.price-block button');
            return b && !b.disabled;
          }, { timeout: 5000 })
          .catch(() => {});
        await page.evaluate(() => {
          const btn = document.querySelector('.price-block button');
          if (btn) btn.removeAttribute('disabled');
        });
        await revealButton.click({ force: true, timeout: 2000 });
      } catch (e) {
        console.log(`  [diagnostic] reveal click try ${clickTry} failed: ${e.message}`);
      }

      // Did it move off "price-idle" (loading, success, or error all count
      // as "the click registered")? If so, stop retrying the click and
      // let the normal outcome-polling below take over.
      await page.waitForTimeout(800);
      const stillIdle = await page
        .locator(SELECTORS.priceBlock)
        .first()
        .evaluate((el) => /price-idle/.test(el.className))
        .catch(() => true);
      if (!stillIdle) break;
      console.log(`  [diagnostic] still price-idle after click try ${clickTry}, retrying...`);
    }

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
          // Also wait for the transient "Updating…" text to clear and the
          // price element to reach full opacity -- confirmed via testing
          // that price-success can appear WHILE the number is still
          // mid-animation (opacity ~0.45, an "Updating…" span still
          // present), and grabbing it then risks a not-yet-final value.
          const stillUpdating = Array.from(document.querySelectorAll('.price-main span')).some((s) =>
            s.textContent.includes('Updating')
          );
          const priceOpacity = priceEl ? parseFloat(getComputedStyle(priceEl).opacity) : 0;
          if (
            /price-success/.test(className) &&
            priceEl &&
            priceEl.textContent.trim().length > 0 &&
            !stillUpdating &&
            priceOpacity >= 0.99
          ) {
            return { done: true, failed: false };
          }
          return false; // still loading -- keep polling
        },
        { blockSelector: SELECTORS.priceBlock, priceSelector: SELECTORS.priceValue },
        { timeout: ELEMENT_TIMEOUT_MS }
      )
      .then((handle) => handle.jsonValue())
      .catch(async (timeoutErr) => {
        // DIAGNOSTIC: on timeout, dump exactly what the price block looks
        // like right now, so we can see what state it's actually stuck in
        // instead of guessing.
        const stuckHtml = await page
          .locator(SELECTORS.priceBlock)
          .first()
          .evaluate((el) => el.outerHTML)
          .catch(() => '(could not read .price-block -- selector may not match anything)');
        console.log('  [diagnostic] .price-block HTML at timeout:\n', stuckHtml);
        throw timeoutErr;
      });

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
    // ones, and force Chromium's newer headless mode (much closer to a
    // real rendered browser than the old headless implementation).
    args: ['--disable-blink-features=AutomationControlled', '--headless=new'],
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