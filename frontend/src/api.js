/**
 * API HELPERS
 * ---------------------------------------------------
 * Thin wrappers around fetch(), one per backend endpoint. Keeping these
 * in one file means every component talks to the backend the same way,
 * and if the backend URL changes (e.g. moving from localhost to Render),
 * we only change it in one place: BASE_URL below.
 */

// While developing locally, this points at your local backend.
// Once deployed, change this to your Render URL, e.g.
// 'https://price-tracker-backend.onrender.com'
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

// GET /search?q=... -> { results: [{id, name, brand, category, sku, url}] }
export async function searchProducts(query) {
  const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`);
  return handle(res);
}

// POST /track { name, url } -> { product }
export async function trackProduct(name, url) {
  const res = await fetch(`${BASE_URL}/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, url }),
  });
  return handle(res);
}

// GET /products -> { products }
export async function getTrackedProducts() {
  const res = await fetch(`${BASE_URL}/products`);
  return handle(res);
}

// GET /products/:id/history -> { history }
export async function getProductHistory(productId) {
  const res = await fetch(`${BASE_URL}/products/${productId}/history`);
  return handle(res);
}

// GET /products/:id/logs -> { logs }
export async function getProductLogs(productId) {
  const res = await fetch(`${BASE_URL}/products/${productId}/logs`);
  return handle(res);
}

// POST /scrape { productId } -> { scraped, results } -- manual "check now"
export async function scrapeNow(productId) {
  const res = await fetch(`${BASE_URL}/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId }),
  });
  return handle(res);
}
