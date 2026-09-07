/**
 * Pure helpers for the Google Identity Services sign-in / account-linking flow.
 *
 * The parsing/building/normalizing helpers are DOM-free so `node --test
 * test/*.test.js` can load them directly (mirroring ./rooms.js and
 * ./toasts.js). The only DOM-touching export, loadGsiScript(), takes the
 * document as an argument so it stays unit-testable with a fake document.
 */

export const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
export const GSI_SCRIPT_ID = 'google-gsi-client';

const HTTP_FALLBACK_MESSAGES = {
  401: "Google couldn't verify this sign-in. Please try again.",
  409: 'This Google account is already linked to a different Noughtline account.',
  503: "Google sign-in isn't configured on the server yet.",
};

const GENERIC_FAILURE_MESSAGE = 'Account linking failed. Please try again.';
const TRANSPORT_FAILURE_MESSAGE = 'Could not reach the server. Check your connection and try again.';

/**
 * Defensively read GET /api/auth/providers. Any shape that is not an explicit
 * `{ google: { configured: true } }` is treated as "not configured" so the
 * client degrades to the informational sign-in notice whenever the endpoint
 * is missing (server PR not deployed), fails, or reports unconfigured.
 *
 * @param {unknown} data
 * @returns {boolean}
 */
export function parseProviderResponse(data) {
  if (!data || typeof data !== 'object' || !data.google || typeof data.google !== 'object') return false;
  return data.google.configured === true;
}

/**
 * Classify what the Sign in with Google button should do based on the latest
 * provider knowledge. The initial state is "unknown" (the providers endpoint
 * has not resolved yet): clicking during that window must NOT claim the server
 * is unconfigured — the handler re-checks instead.
 *
 * @param {{configured?: boolean, loaded?: boolean, clientId?: unknown}} state
 * @returns {'enabled'|'unknown'|'unconfigured'}
 */
export function signInAvailability({ configured = false, loaded = false, clientId } = {}) {
  if (configured === true && typeof clientId === 'string' && clientId.trim() !== '') return 'enabled';
  if (loaded !== true) return 'unknown';
  return 'unconfigured';
}

/**
 * Google sign-in is only offered when the server reports the provider as
 * configured AND the build was given a VITE_GOOGLE_CLIENT_ID. The Vite
 * env var compiles to '' when unset, so an empty string must count as off.
 *
 * @param {boolean} providerConfigured
 * @param {unknown} clientId
 * @returns {boolean}
 */
export function isGoogleEnabled(providerConfigured, clientId) {
  return Boolean(providerConfigured)
    && typeof clientId === 'string'
    && clientId.trim().length > 0;
}

/**
 * Build the GIS `IdConfiguration` for one sign-in attempt. The nonce is
 * single-use server-side, so a fresh config (and fresh nonce) is required for
 * every attempt; a cancelled or failed attempt must never reuse the old nonce.
 *
 * @param {{clientId?: string, nonce?: string, callback?: Function}} inputs
 * @returns {{client_id: string, nonce: string, callback: Function, auto_select: boolean} | null}
 */
export function buildGoogleIdConfig({ clientId, nonce, callback }) {
  if (typeof clientId !== 'string' || clientId.trim() === '' || !nonce || typeof callback !== 'function') {
    return null;
  }
  return {
    client_id: clientId,
    nonce,
    callback,
    // Never auto-select an account: the user clicked the button deliberately.
    auto_select: false,
  };
}

/**
 * Turn a failed account-linking error into a displayable message.
 *
 * Axios-shaped failures (`error.response`) surface the server's message
 * verbatim when present — the GOOGLE_LINK_CONFLICT explanation (export/delete
 * path) must be shown exactly as the server wrote it — and fall back to a
 * status-appropriate friendly message otherwise. Non-HTTP failures distinguish
 * transport noise (axios "Network Error", timeouts) from meaningful local
 * errors, which pass through verbatim.
 *
 * @param {unknown} error
 * @returns {{message: string, code: string|null, status: number, canceled: boolean}}
 */
export function normalizeGoogleError(error) {
  const response = error && error.response;
  if (response) {
    const body = response.data && typeof response.data === 'object' ? response.data : {};
    const fallback = HTTP_FALLBACK_MESSAGES[response.status] || GENERIC_FAILURE_MESSAGE;
    const message = body.error || body.message || fallback;
    return {
      message,
      code: typeof body.code === 'string' ? body.code : null,
      status: response.status,
      canceled: false,
    };
  }

  const code = (error && error.code) || null;
  if (code === 'ERR_CANCELED') {
    return { message: '', code, status: 0, canceled: true };
  }

  const rawMessage = (error && error.message) || '';
  const isTransportNoise = !rawMessage
    || rawMessage === 'Network Error'
    || /^timeout of \d+ms exceeded$/.test(rawMessage)
    || /^Request failed with status code \d+$/.test(rawMessage);
  return {
    message: isTransportNoise ? TRANSPORT_FAILURE_MESSAGE : rawMessage,
    code,
    status: 0,
    canceled: false,
  };
}

let gsiScriptPromise = null;

/**
 * Test hook: clear the cached script promise between loadGsiScript tests.
 * The cache is also cleared automatically when a load fails so retries work.
 */
export function resetGsiScriptLoader() {
  gsiScriptPromise = null;
}

/**
 * Load https://accounts.google.com/gsi/client exactly once and resolve when
 * the API is ready. Idempotent: concurrent callers share one promise, an
 * in-DOM script or an already-present `google.accounts.id` short-circuits,
 * and a failed load rejects but leaves the loader ready for a later attempt.
 *
 * @param {Document} [doc]
 * @returns {Promise<void>}
 */
export function loadGsiScript(doc = globalThis.document) {
  if (gsiScriptPromise) return gsiScriptPromise;

  const win = doc && doc.defaultView;
  if (win && win.google && win.google.accounts && win.google.accounts.id) {
    gsiScriptPromise = Promise.resolve();
    return gsiScriptPromise;
  }

  gsiScriptPromise = new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.id = GSI_SCRIPT_ID;
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Remove the dead script node so a retry truly re-injects instead of
      // resolving against a tag that never loaded, and do not cache the
      // failure: the next attempt may succeed.
      if (doc.head && typeof doc.head.removeChild === 'function') {
        doc.head.removeChild(script);
      }
      gsiScriptPromise = null;
      reject(new Error("Google's sign-in script could not be loaded."));
    };
    doc.head.appendChild(script);
  });
  return gsiScriptPromise;
}
