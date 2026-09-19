import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getProductHistory, getProductLogs, scrapeNow } from '../api';

/**
 * PRODUCT DASHBOARD
 * ---------------------------------------------------
 * Shows one tracked product's:
 *  - latest known price (the last row of price_history)
 *  - a chart of price over time
 *  - a scrape log table (every attempt, including failures)
 *
 * Data flow: on mount / whenever the selected product changes, we call
 * GET /products/:id/history and GET /products/:id/logs. These read
 * whatever the last cron-triggered scrape wrote to Supabase -- this page
 * does NOT poll the live store itself.
 */
export default function ProductDashboard({ product }) {
  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [historyRes, logsRes] = await Promise.all([
        getProductHistory(product.id),
        getProductLogs(product.id),
      ]);
      setHistory(historyRes.history);
      setLogs(logsRes.logs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  async function handleCheckNow() {
    setChecking(true);
    try {
      await scrapeNow(product.id);
      await loadData(); // refresh with whatever this scrape produced
    } finally {
      setChecking(false);
    }
  }

  const latest = history[history.length - 1];
  const chartData = history.map((h) => ({
    time: new Date(h.scraped_at).toLocaleString(),
    price: Number(h.price),
  }));

  if (loading) return <p className="muted">Loading...</p>;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>{product.name}</h2>
        <button onClick={handleCheckNow} disabled={checking}>
          {checking ? 'Checking...' : 'Check now'}
        </button>
      </div>

      {latest ? (
        <div className="latest-price">
          <span className="price">₹{latest.price}</span>
          {latest.original_price && <span className="strike">₹{latest.original_price}</span>}
          <span className="muted"> · {latest.stock_text || 'stock unknown'}</span>
          <div className="muted small">Last checked: {new Date(latest.scraped_at).toLocaleString()}</div>
        </div>
      ) : (
        <p className="muted">No successful scrape yet for this product.</p>
      )}

      <h3>Price history</h3>
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} />
            <YAxis domain={['auto', 'auto']} />
            <Tooltip />
            <Line type="monotone" dataKey="price" stroke="#2f855a" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <p className="muted">No history yet — check back after the next scheduled scrape.</p>
      )}

      <h3>Scrape log</h3>
      <table className="log-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className={`status-${log.status}`}>
              <td>{new Date(log.attempted_at).toLocaleString()}</td>
              <td>{log.status}</td>
              <td>{log.attempts}</td>
              <td>{log.error_message || '—'}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">No scrape attempts logged yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
