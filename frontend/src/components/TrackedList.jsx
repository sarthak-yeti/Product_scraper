/**
 * TRACKED PRODUCTS TABLE
 * ---------------------------------------------------
 * Table of everything the user is tracking. Clicking a row opens its
 * dashboard (price history + scrape log).
 */
export default function TrackedList({ products, selectedId, onSelect }) {
  if (products.length === 0) {
    return <p className="muted">Nothing tracked yet. Search above and hit "Track" on a product.</p>;
  }

  return (
    <table className="data-table tracked-table">
      <thead>
        <tr>
          <th>Product</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr
            key={p.id}
            className={p.id === selectedId ? 'row-selected' : ''}
            onClick={() => onSelect(p.id)}
          >
            <td>{p.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
