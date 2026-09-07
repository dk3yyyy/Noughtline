const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = Object.freeze(['accounts.google.com', 'https://accounts.google.com']);
const GOOGLE_NONCE_TTL_MS = 10 * 60 * 1000;
const JWKS_CACHE_MS = 60 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;

function verifyFailed() {
  return Object.assign(new Error('Google sign-in could not be verified'), { code: 'GOOGLE_VERIFY_FAILED' });
}

// Creates the Google sign-in dependency bundle: a single-use nonce store and an
// ID-token verifier that validates RS256 signatures against Google's published
// JWKS (https://www.googleapis.com/oauth2/v3/certs). `tokenVerifier` can be
// injected in tests to avoid network access; `fetchImpl` and `now` follow the
// same injection conventions as economy.js. `jwksFetchTimeoutMs` bounds how
// long a hung Google certs fetch can pin the shared in-flight request.
function createGoogleAuth({
  config,
  fetchImpl = global.fetch,
  now = () => Date.now(),
  tokenVerifier,
  jwksFetchTimeoutMs = JWKS_FETCH_TIMEOUT_MS,
} = {}) {
  const nonces = new Map();
  let jwksCache = null;
  let jwksInflight = null;

  function isConfigured() {
    return Boolean(config && config.googleClientId);
  }

  function pruneNonces() {
    const current = now();
    let removed = 0;
    for (const [nonce, entry] of nonces.entries()) {
      if (entry.expiresAt > current) continue;
      nonces.delete(nonce);
      removed += 1;
    }
    return removed;
  }

  function issueNonce(userId) {
    pruneNonces();
    const nonce = crypto.randomBytes(24).toString('base64url');
    nonces.set(nonce, { userId, expiresAt: now() + GOOGLE_NONCE_TTL_MS });
    return nonce;
  }

  // Single-use: the nonce is removed on the first attempt regardless of outcome.
  function consumeNonce(nonce, userId) {
    pruneNonces();
    const entry = nonces.get(nonce);
    if (!entry) return false;
    nonces.delete(nonce);
    return entry.expiresAt > now() && entry.userId === userId;
  }

  async function fetchJwks(force = false) {
    if (!force && jwksCache && jwksCache.expiresAt > now()) return jwksCache.keysByKid;
    if (jwksInflight) return jwksInflight;
    jwksInflight = (async () => {
      let response;
      try {
        // Bounding the fetch keeps a hung Google certs endpoint from pinning the
        // shared in-flight request (and thus every concurrent verification).
        response = await fetchImpl(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(jwksFetchTimeoutMs) });
      } catch {
        throw verifyFailed();
      }
      if (!response || !response.ok) throw verifyFailed();
      const body = await response.json();
      const keysByKid = new Map();
      for (const key of Array.isArray(body && body.keys) ? body.keys : []) {
        if (key && key.kty === 'RSA' && key.use === 'sig' && key.kid && key.n && key.e) {
          keysByKid.set(key.kid, key);
        }
      }
      if (keysByKid.size === 0) throw verifyFailed();
      jwksCache = { keysByKid, expiresAt: now() + JWKS_CACHE_MS };
      return keysByKid;
    })();
    try {
      return await jwksInflight;
    } finally {
      jwksInflight = null;
    }
  }

  async function defaultVerifyIdToken({ idToken, nonce }) {
    if (!isConfigured()) throw verifyFailed();
    if (typeof idToken !== 'string' || !idToken) throw verifyFailed();

    let decoded;
    try {
      decoded = jwt.decode(idToken, { complete: true });
    } catch {
      throw verifyFailed();
    }
    if (!decoded || !decoded.header || !decoded.payload) throw verifyFailed();
    const { header, payload } = decoded;
    if (header.alg !== 'RS256' || !header.kid) throw verifyFailed();

    // Cheap rejections before any network fetch; jwt.verify below re-checks the
    // signature and every claim authoritatively.
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now()) throw verifyFailed();
    if (payload.nonce !== nonce) throw verifyFailed();
    if (payload.email_verified !== true || typeof payload.email !== 'string' || !payload.email) throw verifyFailed();

    let keysByKid = await fetchJwks();
    if (!keysByKid.has(header.kid)) keysByKid = await fetchJwks(true);
    const jwk = keysByKid.get(header.kid);
    if (!jwk) throw verifyFailed();

    let publicKey;
    try {
      publicKey = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    } catch {
      throw verifyFailed();
    }

    let verified;
    try {
      verified = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        issuer: GOOGLE_ISSUERS,
        audience: config.googleClientId,
      });
    } catch {
      throw verifyFailed();
    }
    if (verified.nonce !== nonce
      || verified.email_verified !== true
      || typeof verified.email !== 'string'
      || !verified.email) {
      throw verifyFailed();
    }

    return {
      sub: String(verified.sub),
      email: verified.email,
      email_verified: true,
      name: typeof verified.name === 'string' ? verified.name : null,
      picture: typeof verified.picture === 'string' ? verified.picture : null,
    };
  }

  return {
    isConfigured,
    issueNonce,
    consumeNonce,
    pruneNonces,
    verifyIdToken: tokenVerifier || defaultVerifyIdToken,
    nonceTtlMs: GOOGLE_NONCE_TTL_MS,
    get size() {
      return nonces.size;
    },
  };
}

module.exports = { createGoogleAuth, GOOGLE_CERTS_URL, GOOGLE_ISSUERS, GOOGLE_NONCE_TTL_MS };
