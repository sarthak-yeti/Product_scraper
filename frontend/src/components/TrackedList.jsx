/**
 * TRACKED PRODUCTS LIST
 * ---------------------------------------------------
 * Simple list of everything the user is tracking. Clicking one opens its
 * dashboard (price history + scrape log).
 */
export default function TrackedList({ products, selectedId, onSelect }) {
  if (products.length === 0) {
    return <p className="muted">Nothing tracked yet. Search above and hit "Track" on a product.</p>;
  }

  return (
    <ul className="tracked-list">
      {products.map((p) => (
        <li key={p.id} className={p.id === selectedId ? 'active' : ''} onClick={() => onSelect(p.id)}>
          {p.name}
        </li>
      ))}
    </ul>
  );
}
