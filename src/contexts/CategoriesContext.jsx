import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listCategories } from '../lib/db';

const Ctx = createContext(null);

export function CategoriesProvider({ children }) {
  const [categories, setCategories] = useState([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const cats = await listCategories();
    setCategories(cats);
    setReady(true);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo(() => {
    const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));
    return {
      categories,
      ready,
      reload,
      byKey,
      name: (key) => byKey[key]?.name || key || '—',
      color: (key) => byKey[key]?.color || '#9b8c74',
      isCredit: (key) => !!byKey[key]?.creditDefault,
    };
  }, [categories, ready, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategories() {
  return useContext(Ctx) || {
    categories: [], ready: false, reload: () => {}, byKey: {},
    name: (k) => k || '—', color: () => '#9b8c74', isCredit: () => false,
  };
}
