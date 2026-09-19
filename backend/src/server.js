/**
 * MAIN SERVER
 * ---------------------------------------------------
 * Endpoints:
 *   GET  /search?q=...            -> search the mock store by name
 *   POST /track                   -> save a chosen product into Supabase
 *   POST /scrape                  -> scrape ONE product (or all, if no id given)
 *                                     this is what cron-job.org will call every 2h
 *   GET  /products                -> list tracked products
 *   GET  /products/:id/history    -> price history for the chart/table
 *   GET  /products/:id/logs       -> scrape attempt log
 *
 * HOW A REQUEST FLOWS (example: POST /scrape):
 *   1. cron-job.org sends an HTTP POST to https://your-backend.onrender.com/scrape
 *   2. Express receives it, looks up which product(s) to scrape from Supabase
 *   3. For each one, calls scrapeProduct(url) from scraper.js (launches a
 *      real headless browser, waits, retries, returns an honest result)
 *   4. Regardless of success or failure, we ALWAYS write one row to
 *      scrape_log (so failures are visible)
 *   5. ONLY on success/retried do we ALSO write a row to price_history
 *      (so history never contains fake/empty data)
 *   6. Responds with a summary so you can see what happened in the
 *      response body too, useful for debugging via cron-job.org's logs
 */
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { supabase } = require('./supabaseClient');
const { scrapeProduct } = require('./scraper');
const { searchProducts } = require('./productSearch');

const app = express();
app.use(cors());
app.use(express.json());

// ---------------------------------------------------
// GET /search?q=usb
// ---------------------------------------------------
app.get('/search', async (req, res) => {
  const query = req.query.q || '';
  try {
    const results = await searchProducts(query);
    res.json({ results });
  } catch (err) {
    console.error('Search failed:', err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// ---------------------------------------------------
// POST /track   body: { name, url }
// ---------------------------------------------------
app.post('/track', async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }

  const { data, error } = await supabase
    .from('tracked_products')
    .insert({ name, product_url: url })
    .select()
    .single();

  if (error) {
    // If it's already tracked (unique constraint on product_url), that's
    // a normal case, not a server error -- tell the user clearly.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This product is already being tracked' });
    }
    console.error('Track insert failed:', error);
    return res.status(500).json({ error: 'Could not track product', details: error.message });
  }

  res.status(201).json({ product: data });
});

// ---------------------------------------------------
// GET /products
// ---------------------------------------------------
app.get('/products', async (req, res) => {
  const { data, error } = await supabase
    .from('tracked_products')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ products: data });
});

// ---------------------------------------------------
// POST /scrape   body: { productId } OR {} to scrape ALL tracked products
// This is the endpoint cron-job.org calls every 2 hours.
// ---------------------------------------------------
app.post('/scrape', async (req, res) => {
  const { productId } = req.body || {};

  let productsToScrape;
  if (productId) {
    const { data, error } = await supabase.from('tracked_products').select('*').eq('id', productId).single();
    if (error || !data) return res.status(404).json({ error: 'Product not found' });
    productsToScrape = [data];
  } else {
    const { data, error } = await supabase.from('tracked_products').select('*');
    if (error) return res.status(500).json({ error: error.message });
    productsToScrape = data;
  }

  const summary = [];

  for (const product of productsToScrape) {
    const result = await scrapeProduct(product.product_url);

    // ALWAYS log the attempt -- success, retried, or failed.
    await supabase.from('scrape_log').insert({
      product_id: product.id,
      status: result.status,
      attempts: result.attempts,
      error_message: result.status === 'failed' ? result.error : null,
    });

    // ONLY write to price_history when we actually got a real reading.
    if (result.status === 'success' || result.status === 'retried') {
      await supabase.from('price_history').insert({
        product_id: product.id,
        price: result.price,
        original_price: result.originalPrice,
        stock_text: result.stockText,
        stock_count: result.stockCount,
        in_stock: result.inStock,
      });
    }

    summary.push({ productId: product.id, name: product.name, status: result.status });
  }

  res.json({ scraped: summary.length, results: summary });
});

// ---------------------------------------------------
// GET /products/:id/history
// ---------------------------------------------------
app.get('/products/:id/history', async (req, res) => {
  const { data, error } = await supabase
    .from('price_history')
    .select('*')
    .eq('product_id', req.params.id)
    .order('scraped_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ history: data });
});

// ---------------------------------------------------
// GET /products/:id/logs
// ---------------------------------------------------
app.get('/products/:id/logs', async (req, res) => {
  const { data, error } = await supabase
    .from('scrape_log')
    .select('*')
    .eq('product_id', req.params.id)
    .order('attempted_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data });
});

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));