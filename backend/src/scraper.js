
const { chromium } = require("playwright");

const SELECTORS = {
  block: ".price-block",
  price: '.price-main [class*="pv-"]',
  original: '.price-main [class*="mr-"]',
  stock: ".price-block .stock-badge",
};

const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parsePrice(text) {
  if (!text) return null;

  let clean = text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^0-9.,]/g, "");

  const decimal = clean.match(/[,.](\d{2})$/);
  let suffix = "";

  if (decimal) {
    suffix = "." + decimal[1];
    clean = clean.slice(0, -3);
  }

  clean = clean.replace(/[,.]/g, "");

  const value = parseFloat(clean + suffix);
  return Number.isFinite(value) ? value : null;
}

function parseStock(text) {
  if (!text) return { raw: null, count: null, inStock: null };

  const raw = text.trim();
  const lower = raw.toLowerCase();

  return {
    raw,
    count: raw.match(/\d+/)?.[0]
      ? parseInt(raw.match(/\d+/)[0])
      : null,
    inStock: lower.includes("out of stock")
      ? false
      : lower.includes("stock") || lower.includes("left")
        ? true
        : null,
  };
}

async function attemptScrape(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});

    // Handle cookie popup
    for (let i = 0; i < 3; i++) {
      const accept = page.getByRole("button", { name: /ACCEPT/i }).first();
      const decline = page.getByRole("button", { name: /DECLINE/i }).first();

      try {
        await accept.click({ timeout: 1000 });
      } catch {
        try {
          await decline.click({ timeout: 1000 });
        } catch {
          break;
        }
      }
    }

    await page.evaluate(() =>
      document.querySelector(".cookie-overlay")?.remove()
    );

    // Scratch price block
    const block = page.locator(SELECTORS.block).first();
    await block.scrollIntoViewIfNeeded();

    const box = await block.boundingBox();

    if (box) {
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();

      for (let i = 0; i < 5; i++) {
        await page.mouse.move(
          box.x + box.width - 10,
          box.y + 10 + i * 5,
          { steps: 5 }
        );

        await page.mouse.move(
          box.x + 10,
          box.y + 15 + i * 5,
          { steps: 5 }
        );
      }

      await page.mouse.up();
    }

    // Click reveal button
    try {
      const button = page.locator(".price-block button").first();

      await button.waitFor({ state: "visible", timeout: 3000 });

      await page.evaluate(() => {
        document
          .querySelector(".price-block button")
          ?.removeAttribute("disabled");
      });

      await button.click({ force: true });
    } catch {}

    // Wait for price
    const result = await page.waitForFunction(
      ({ block, price }) => {
        const el = document.querySelector(block);
        const priceEl = document.querySelector(price);

        if (/price-error/.test(el?.className || "")) {
          return {
            failed: true,
            reason:
              document.querySelector(".price-status")?.textContent.trim() ||
              "Price loading failed",
          };
        }

        const updating = [...document.querySelectorAll(".price-main span")]
          .some((x) => x.textContent.includes("Updating"));

        if (
          /price-success/.test(el?.className || "") &&
          priceEl?.textContent.trim() &&
          !updating &&
          parseFloat(getComputedStyle(priceEl).opacity) >= 0.99
        ) {
          return { failed: false };
        }

        return false;
      },
      {
        block: SELECTORS.block,
        price: SELECTORS.price,
      },
      { timeout: 10000 }
    );

    const outcome = await result.jsonValue();

    if (outcome.failed) {
      throw new Error(outcome.reason);
    }

    // Extract data
    const priceText = await page.locator(SELECTORS.price).first().innerText();
    const price = parsePrice(priceText);

    if (price === null) {
      throw new Error(`Invalid price: ${priceText}`);
    }

    let originalText = null;
    let stockText = null;

    try {
      originalText = await page
        .locator(SELECTORS.original)
        .first()
        .innerText({ timeout: 2000 });
    } catch {}

    try {
      stockText = await page
        .locator(SELECTORS.stock)
        .first()
        .innerText({ timeout: 2000 });
    } catch {}

    const stock = parseStock(stockText);

    return {
      status: "success",
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

async function scrapeProduct(url) {
  if (!url) {
    return {
      status: "failed",
      error: "Product URL is required",
    };
  }

  const browser = await chromium.launch({
    headless: true,
  });

  try {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Scraping attempt ${attempt}/${MAX_RETRIES}`);

        const result = await attemptScrape(browser, url);

        return {
          ...result,
          status: attempt === 1 ? "success" : "retried",
          attempts: attempt,
        };

      } catch (error) {
        lastError = error;
        console.log(`Attempt ${attempt} failed: ${error.message}`);

        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY * attempt);
        }
      }
    }

    return {
      status: "failed",
      price: null,
      error: lastError?.message || "Scraping failed",
      attempts: MAX_RETRIES,
      scrapedAt: new Date().toISOString(),
    };

  } finally {
    await browser.close();
  }
}

module.exports = { scrapeProduct };


