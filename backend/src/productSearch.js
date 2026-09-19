/**
 * PRODUCT SEARCH MODULE (v2 -- using the real catalog API)
 * ---------------------------------------------------
 * The store exposes a clean JSON API:
 *   GET https://demo.inelabteamdev.com/api/catalog?page=1&pageSize=20
 * returning { page, pageSize, pages, total, items: [{ id, slug, name,
 * brand, category, sku, description }, ...] }.
 *
 * This is much better than scraping rendered HTML for search: it's a
 * plain HTTP request (fast, no browser needed), and it hands us the real
 * numeric `id`, which is exactly what the product detail page URL uses
 * (https://demo.inelabteamdev.com/product/<id> -- confirmed by testing).
 *
 * We don't know if the API supports server-side filtering (e.g. a
 * ?search= param), so to be safe we pull the whole catalog once and
 * filter by name ourselves. 1000 products / large pageSize is a handful
 * of requests -- fine for a demo catalog this size.
 */
const BASE_URL = 'https://demo.inelabteamdev.com/api/catalog';

/**
 * Fetches every product in the catalog, handling pagination.
 * Tries a large pageSize first (often such demo APIs just return
 * everything in one page if you ask for enough); falls back to walking
 * every page if the server caps it.
 */
async function fetchAllProducts() {
  const firstRes = await fetch(`${BASE_URL}?page=1&pageSize=1000`);
  if (!firstRes.ok) throw new Error(`Catalog API returned ${firstRes.status}`);
  const first = await firstRes.json();

  if (first.items.length >= first.total) {
    return first.items;
  }

  const allItems = [...first.items];
  const pageSize = first.pageSize;
  const totalPages = first.pages;

  for (let page = 2; page <= totalPages; page++) {
    const res = await fetch(`${BASE_URL}?page=${page}&pageSize=${pageSize}`);
    if (!res.ok) throw new Error(`Catalog API returned ${res.status} on page ${page}`);
    const data = await res.json();
    allItems.push(...data.items);
  }

  return allItems;
}

/**
 * Searches by partial/full product name, case-insensitive.
 * Returns { name, url } pairs ready for the frontend / /track endpoint.
 *
 * NOTE: the catalog API does not appear to return pages in a stable order
 * -- the same product can appear on more than one "page" across separate
 * requests. We de-duplicate by id here so the same product never shows up
 * twice in search results.
 */
async function searchProducts(query) {
  const all = await fetchAllProducts();

  const seen = new Set();
  const deduped = [];
  for (const p of all) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      deduped.push(p);
    }
  }

  const q = (query || '').toLowerCase().trim();
  const matches = q ? deduped.filter((p) => p.name.toLowerCase().includes(q)) : deduped.slice(0, 20);

  return matches.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    category: p.category,
    sku: p.sku,
    url: `https://demo.inelabteamdev.com/product/${p.id}`,
  }));
}

module.exports = { searchProducts };