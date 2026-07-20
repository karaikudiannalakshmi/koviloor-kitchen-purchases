import { useCategories } from '../contexts/CategoriesContext';

// Coloured category pill. <Cat k="vegetable" /> or dot only <Cat k="grocery" dot />
export function Cat({ k, dot = false }) {
  const cats = useCategories();
  const color = cats.color(k);
  if (dot) {
    return <span className="cat-dot" style={{ background: color }} title={cats.name(k)} />;
  }
  return (
    <span className="cat-badge" style={{ background: color + '22', color }}>
      <span className="cat-dot" style={{ background: color }} />{cats.name(k)}
    </span>
  );
}
