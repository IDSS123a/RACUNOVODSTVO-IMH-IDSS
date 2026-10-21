import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '@/lib/tauri/invoke';

/** State of an async load: first load shows a spinner, later reloads keep the old data visible. */
export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T; refreshing: boolean };

/**
 * Load data through a repository function that returns a Commander Result.
 * WHY a ref for "loaded once": re-fetches after a save must not unmount children
 * (FEATURE_LIFECYCLE Step 5 — parent refresh pattern).
 * @param loader stable loader (wrap in useCallback at the call site)
 */
export function useAsyncResult<T>(loader: () => Promise<Result<T>>): { state: AsyncState<T>; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const loadedOnce = useRef(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (loadedOnce.current) {
      setState((previous) => (previous.status === 'ready' ? { ...previous, refreshing: true } : previous));
    }
    loader()
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          loadedOnce.current = true;
          setState({ status: 'ready', data: result.data, refreshing: false });
        } else {
          setState({ status: 'error', error: result.error });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [loader, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { state, reload };
}
