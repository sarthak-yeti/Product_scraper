import { useState } from 'react';
import { searchProducts, trackProduct } from '../api';

/**
 * SEARCH PAGE
 * ---------------------------------------------------
 * Flow: user types -> calls GET /search on submit -> shows results ->
 * clicking "Track" calls POST /track -> on success, tells the parent
 * (via onTracked) so it can refresh the tracked-products list.
 */
export default function SearchPage({ onTracked, trackedUrls }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null);

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await searchProducts(query);
      setResults(data.results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleTrack(product) {
    setTrackingId(product.id);
    setError(null);
    try {
      await trackProduct(product.name, product.url);
      onTracked();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrackingId(null);
    }
  }

  return (
    <section className="card">
      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products by name..."
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {results.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Brand</th>
              <th>Category</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((product) => {
              const alreadyTracked = trackedUrls.has(product.url);
              return (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td className="muted">{product.brand}</td>
                  <td className="muted">{product.category}</td>
                  <td className="col-action">
                    <button
                      className="btn-primary"
                      onClick={() => handleTrack(product)}
                      disabled={trackingId === product.id || alreadyTracked}
                    >
                      {alreadyTracked ? 'Tracked' : trackingId === product.id ? 'Tracking...' : 'Track'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!loading && results.length === 0 && query && (
        <p className="muted">No results yet — try searching above.</p>
      )}
    </section>
  );
}
