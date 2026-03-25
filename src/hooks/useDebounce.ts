import { useState, useEffect } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms
 * of silence. Cancel any pending timeout when the component unmounts.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
