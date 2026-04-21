/**
 * Resolves with `fallback` after `ms` if `p` has not settled — does not cancel `p`.
 * Prefer {@link combinedSignal} + fetch abort for third-party calls when possible.
 */
export function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      () => {
        clearTimeout(id);
        resolve(fallback);
      },
    );
  });
}

/** Abort when `parent` aborts or after `ms` (whichever first). */
export function combinedSignal(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  if (!parent) return t;
  const any = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof any === 'function') {
    return any([parent, t]);
  }
  const ac = new AbortController();
  const done = () => {
    try {
      ac.abort();
    } catch {
      /* noop */
    }
  };
  parent.addEventListener('abort', done, { once: true });
  t.addEventListener('abort', done, { once: true });
  return ac.signal;
}
