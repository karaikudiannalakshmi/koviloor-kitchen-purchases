import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const nav = [
  { to: '/', label: 'Dashboard', ico: '◧', end: true },
  { to: '/bills/new', label: 'New Bill', ico: '＋' },
  { to: '/bills', label: 'Bills Ledger', ico: '▤' },
  { to: '/ledger', label: 'Ingredient Ledger', ico: '⤢' },
  { to: '/daily-log', label: 'Daily Log', ico: '🥛' },
];
const masters = [
  { to: '/vendors', label: 'Vendors', ico: '☖' },
  { to: '/ingredients', label: 'Ingredients', ico: '✿' },
  { to: '/categories', label: 'Categories', ico: '◆' },
];

export default function Layout({ children }) {
  const { logout } = useAuth();
  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand-logo-link">
          <img src="/logo.jpg" alt="Sanatana Dharma Trust Annadhanam" className="brand-logo" />
        </NavLink>

        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico">{n.ico}</span> {n.label}
            </NavLink>
          ))}
          <div className="nav-label">Masters</div>
          {masters.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico">{n.ico}</span> {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="logout" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
