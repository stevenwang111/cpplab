/**
 * Cross-origin isolation bootstrap.
 *
 * SharedArrayBuffer (and therefore the fast async strategy inside the compiler
 * worker) requires COOP/COEP. A static host that cannot set headers can still
 * get isolation through a service worker; we inject the one shipped with the
 * toolchain instead of asking the user to configure anything.
 *
 * The attempt is remembered per tab so a host that legitimately cannot be
 * isolated never ends up in a reload loop.
 */
import { isCrossOriginIsolated } from '../capabilities';

const ATTEMPT_KEY = 'cpplab.coiAttempt';

export function ensureCrossOriginIsolation(): void {
  if (isCrossOriginIsolated()) return;
  try {
    if (sessionStorage.getItem(ATTEMPT_KEY)) return;
    sessionStorage.setItem(ATTEMPT_KEY, '1');
  } catch {
    // Session storage can be unavailable; skip the opt-in reload dance.
    return;
  }

  void (async () => {
    try {
      const { default: workerUrl } = await import('@gameguild/emception-browser/coi-serviceworker.js?url');
      const script = document.createElement('script');
      script.src = workerUrl;
      script.async = false;
      document.head.appendChild(script);
    } catch {
      // No isolation: the toolchain falls back to a slower async strategy.
    }
  })();
}
