import { useEffect, useState } from 'react';
import SearchPage from './components/SearchPage';
import TrackedList from './components/TrackedList';
import ProductDashboard from './components/ProductDashboard';
import { getTrackedProducts } from './api';
import './App.css';

/**
 * APP ROOT
 * ---------------------------------------------------
 * Layout: search bar + results at top, tracked-products list on the
 * left, and the selected product's dashboard on the right. Simple
 * state-based view -- no router needed for something this small.
 */
export default function App() {
  const [tracked, setTracked] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  async function refreshTracked() {
    const data = await getTrackedProducts();
    setTracked(data.products);
    // If nothing is selected yet, select the first one automatically.
    if (!selectedId && data.products.length > 0) {
      setSelectedId(data.products[0].id);
    }
  }

  useEffect(() => {
    refreshTracked();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedProduct = tracked.find((p) => p.id === selectedId);

  return (
    <div className="app">
      <header>
        <h1>INE Price Tracker</h1>
      </header>

      <SearchPage onTracked={refreshTracked} />

      <div className="main-layout">
        <aside>
          <h3>Tracked products</h3>
          <TrackedList products={tracked} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>

        <main>
          {selectedProduct ? (
            <ProductDashboard product={selectedProduct} />
          ) : (
            <p className="muted">Select a tracked product to see its price history.</p>
          )}
        </main>
      </div>
    </div>
  );
}
