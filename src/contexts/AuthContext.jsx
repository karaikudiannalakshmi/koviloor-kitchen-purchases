import { createContext, useContext, useEffect, useState } from 'react';
import { auth } from '../firebase';
import { signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';

const AuthContext = createContext(null);
const SESSION_KEY = 'kal_purchase_authed';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      // Only treat as logged-in if BOTH the Firebase anon session exists
      // AND the password gate was cleared in this browser session.
      const gate = sessionStorage.getItem(SESSION_KEY) === 'yes';
      setUser(u && gate ? u : null);
      setReady(true);
    });
    return unsub;
  }, []);

  async function login(password) {
    const expected = import.meta.env.VITE_APP_PASSWORD;
    if (!expected) throw new Error('App password is not configured (VITE_APP_PASSWORD).');
    if (password !== expected) throw new Error('Incorrect password.');
    await signInAnonymously(auth);
    sessionStorage.setItem(SESSION_KEY, 'yes');
    setUser(auth.currentUser);
  }

  async function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    await signOut(auth);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
