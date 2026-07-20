import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(''); setBusy(true);
    try {
      await login(pw);
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img src="/logo.jpg" alt="Koviloor Kitchen" className="login-logo" />
        <p>Koviloor Kitchen · Purchase Ledger</p>
        <div className="field">
          <label>Access password</label>
          <input
            type="password"
            value={pw}
            autoFocus
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="••••••••"
          />
        </div>
        <div className="login-err">{err}</div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submit} disabled={busy}>
          {busy ? 'Signing in…' : 'Enter'}
        </button>
      </div>
    </div>
  );
}
