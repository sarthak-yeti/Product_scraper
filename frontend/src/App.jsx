import { useEffect, useState } from 'react';
import SearchPage from './components/SearchPage';
import TrackedList from './components/TrackedList';
import ProductDashboard from './components/ProductDashboard';
import { getTrackedProducts, scrapeAll } from './api';
import './App.css';

export default function App() {
  const [tracked, setTracked] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [showTrackedPanel, setShowTrackedPanel] = useState(false);

  async function refreshTracked() {
    const data = await getTrackedProducts();
    setTracked(data.products);
    setSelectedId((prev) => prev ?? (data.products[0] ? data.products[0].id : null));
  }

  useEffect(() => {
    refreshTracked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      await scrapeAll();
    } finally {
      setCheckingAll(false);
    }
  }

  function handleSelect(id) {
    setSelectedId(id);
    setShowTrackedPanel(false); // picking one closes the panel
  }

  const selectedProduct = tracked.find((p) => p.id === selectedId);
  const trackedUrls = new Set(tracked.map((p) => p.product_url));

  return (
    <div className="app">
      <header>
        <h1>INE Price Tracker</h1>
      </header>

      <SearchPage onTracked={refreshTracked} trackedUrls={trackedUrls} />

      <div className="toolbar">
        <button className="btn-secondary" onClick={() => setShowTrackedPanel((v) => !v)}>
          Tracked products ({tracked.length}) {showTrackedPanel ? '▲' : '▼'}
        </button>
        <button className="btn-secondary" onClick={handleCheckAll} disabled={checkingAll || tracked.length === 0}>
          {checkingAll ? 'Checking all...' : 'Check all'}
        </button>
        {selectedProduct && <span className="muted current-label">Viewing: {selectedProduct.name}</span>}
      </div>

      {showTrackedPanel && (
        <div className="card">
          <TrackedList products={tracked} selectedId={selectedId} onSelect={handleSelect} />
        </div>
      )}

      <div className="card dashboard-card">
        {selectedProduct ? (
          <ProductDashboard key={selectedProduct.id} product={selectedProduct} />
        ) : (
          <p className="muted">Select a tracked product to see its price history.</p>
        )}
      </div>
    </div>
  );
}
