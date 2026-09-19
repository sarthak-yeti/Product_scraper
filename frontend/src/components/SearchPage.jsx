import { useState } from 'react';
import { searchProducts, trackProduct } from '../api';

/**
 * SEARCH PAGE
 * ---------------------------------------------------
 * Flow: user types -> calls GET /search on submit -> shows results ->
 * clicking "Track" calls POST /track -> on success, tells the parent
 * (via onTracked) so it can refresh the tracked-products list.
 */
export default function SearchPage({ onTracked }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trackingId, setTrackingId] = useState(null); // which row is mid-submit

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
      onTracked(); // let the parent refresh the tracked list
    } catch (err) {
      setError(err.message);
    } finally {
      setTrackingId(null);
    }
  }

  return (
    <div className="search-page">
      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products by name..."
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <ul className="result-list">
        {results.map((product) => (
          <li key={product.id} className="result-row">
            <div>
              <strong>{product.name}</strong>
              <span className="muted"> — {product.brand} · {product.category}</span>
            </div>
            <button onClick={() => handleTrack(product)} disabled={trackingId === product.id}>
              {trackingId === product.id ? 'Tracking...' : 'Track'}
            </button>
          </li>
        ))}
      </ul>

      {!loading && results.length === 0 && query && <p className="muted">No results yet — try searching above.</p>}
    </div>
  );
}
