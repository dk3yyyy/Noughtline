const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('crypto');
const jwt = require('jsonwebtoken');
const { createGoogleAuth, GOOGLE_NONCE_TTL_MS } = require('../googleAuth');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = pair.publicKey.export({ format: 'jwk' });
const KID = 'google-test-key-1';

function jwkKey(kid) {
  return { kty: 'RSA', use: 'sig', alg: 'RS256', kid, n: jwk.n, e: jwk.e };
}

function signToken({ claims = {}, key = pair.privateKey, kid = KID, algorithm = 'RS256' } = {}) {
  const nowS = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-sub-123',
    email: 'player@example.com',
    email_verified: true,
    nonce: 'nonce-abc',
    iat: nowS,
    exp: nowS + 3600,
    ...claims,
  };
  return jwt.sign(payload, key, { algorithm, keyid: kid });
}

function countingFetch(sequence) {
  const calls = [];
  const impl = async () => {
    calls.push(calls.length + 1);
    const keys = typeof sequence === 'function' ? sequence(calls.length) : sequence;
    return { ok: true, json: async () => ({ keys }) };
  };
  impl.calls = calls;
  return impl;
}

function createAuth(fetchImpl) {
  return createGoogleAuth({ config: { googleClientId: CLIENT_ID }, fetchImpl });
}

test('verifyIdToken accepts a valid Google-style ID token', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  const result = await auth.verifyIdToken({ idToken: signToken(), nonce: 'nonce-abc' });
  assert.equal(result.sub, 'google-sub-123');
  assert.equal(result.email, 'player@example.com');
  assert.equal(result.email_verified, true);
});

test('verifyIdToken rejects a token whose nonce claim does not match', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  await assert.rejects(
    () => auth.verifyIdToken({ idToken: signToken(), nonce: 'some-other-nonce' }),
    (error) => error.code === 'GOOGLE_VERIFY_FAILED',
  );
});

test('verifyIdToken rejects unverified emails and missing emails', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  await assert.rejects(() => auth.verifyIdToken({ idToken: signToken({ claims: { email_verified: false } }), nonce: 'nonce-abc' }));
  await assert.rejects(() => auth.verifyIdToken({ idToken: signToken({ claims: { email_verified: 'true' } }), nonce: 'nonce-abc' }));
  await assert.rejects(() => auth.verifyIdToken({ idToken: signToken({ claims: { email: undefined } }), nonce: 'nonce-abc' }));
});

test('verifyIdToken rejects tokens issued for another audience', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  await assert.rejects(
    () => auth.verifyIdToken({ idToken: signToken({ claims: { aud: 'evil-client.apps.googleusercontent.com' } }), nonce: 'nonce-abc' }),
    (error) => error.code === 'GOOGLE_VERIFY_FAILED',
  );
});

test('verifyIdToken rejects tokens from an unknown issuer', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  await assert.rejects(
    () => auth.verifyIdToken({ idToken: signToken({ claims: { iss: 'https://evil.example.com' } }), nonce: 'nonce-abc' }),
    (error) => error.code === 'GOOGLE_VERIFY_FAILED',
  );
});

test('verifyIdToken rejects expired tokens', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  const past = Math.floor(Date.now() / 1000) - 60;
  await assert.rejects(
    () => auth.verifyIdToken({ idToken: signToken({ claims: { exp: past } }), nonce: 'nonce-abc' }),
    (error) => error.code === 'GOOGLE_VERIFY_FAILED',
  );
});

test('verifyIdToken rejects tokens signed by a different key', async () => {
  const auth = createAuth(countingFetch([jwkKey(KID)]));
  await assert.rejects(
    () => auth.verifyIdToken({ idToken: signToken({ key: other.privateKey }), nonce: 'nonce-abc' }),
    (error) => error.code === 'GOOGLE_VERIFY_FAILED',
  );
});

test('verifyIdToken rejects non-RS256 tokens before any certificate fetch', async () => {
  const fetchImpl = countingFetch([jwkKey(KID)]);
  const auth = createAuth(fetchImpl);
  const nowS = Math.floor(Date.now() / 1000);
  const hmacToken = jwt.sign(
    { iss: 'accounts.google.com', aud: CLIENT_ID, sub: 'x', email: 'x@example.com', email_verified: true, nonce: 'nonce-abc', iat: nowS, exp: nowS + 3600 },
    'hmac-secret',
    { algorithm: 'HS256', keyid: KID },
  );
  await assert.rejects(() => auth.verifyIdToken({ idToken: hmacToken, nonce: 'nonce-abc' }));
  assert.equal(fetchImpl.calls.length, 0);
});

test('verifyIdToken refetches certificates once for an unknown key id', async () => {
  const fetchImpl = countingFetch((call) => (call === 1 ? [jwkKey('rotated-old-key')] : [jwkKey(KID)]));
  const auth = createAuth(fetchImpl);
  const token = signToken();
  const result = await auth.verifyIdToken({ idToken: token, nonce: 'nonce-abc' });
  assert.equal(result.sub, 'google-sub-123');
  assert.equal(fetchImpl.calls.length, 2);
  // The refreshed key set is cached: a second verify must not fetch again.
  await auth.verifyIdToken({ idToken: token, nonce: 'nonce-abc' });
  assert.equal(fetchImpl.calls.length, 2);
});

test('verifyIdToken rejects garbage tokens without a certificate fetch', async () => {
  const fetchImpl = countingFetch([jwkKey(KID)]);
  const auth = createAuth(fetchImpl);
  await assert.rejects(() => auth.verifyIdToken({ idToken: 'not.a.jwt', nonce: 'nonce-abc' }));
  await assert.rejects(() => auth.verifyIdToken({ idToken: '', nonce: 'nonce-abc' }));
  assert.equal(fetchImpl.calls.length, 0);
});

test('verifyIdToken fails closed when no client id is configured', async () => {
  const fetchImpl = countingFetch([jwkKey(KID)]);
  const auth = createGoogleAuth({ config: { googleClientId: '' }, fetchImpl });
  await assert.rejects(() => auth.verifyIdToken({ idToken: signToken(), nonce: 'nonce-abc' }));
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(auth.isConfigured(), false);
});

test('nonces are random, single-use, session-bound, and expire after the TTL', () => {
  let clock = 1_000_000;
  const auth = createGoogleAuth({ config: { googleClientId: CLIENT_ID }, now: () => clock });

  assert.equal(GOOGLE_NONCE_TTL_MS, 600_000);
  assert.equal(auth.isConfigured(), true);

  const first = auth.issueNonce(1);
  const second = auth.issueNonce(1);
  assert.equal(first.length, 32);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);

  // Single use: a second consume of the same nonce fails.
  assert.equal(auth.consumeNonce(first, 1), true);
  assert.equal(auth.consumeNonce(first, 1), false);

  // Bound to the session that issued it.
  const third = auth.issueNonce(2);
  assert.equal(auth.consumeNonce(third, 3), false);

  // Expiry: advance the clock past the TTL.
  const fourth = auth.issueNonce(4);
  clock += GOOGLE_NONCE_TTL_MS + 1;
  assert.equal(auth.consumeNonce(fourth, 4), false);

  // Unknown nonces never consume.
  assert.equal(auth.consumeNonce('never-issued', 1), false);
});

test('pruneNonces drops only expired nonces', () => {
  let clock = 2_000_000;
  const auth = createGoogleAuth({ config: { googleClientId: CLIENT_ID }, now: () => clock });
  auth.issueNonce(1);
  auth.issueNonce(1);
  assert.equal(auth.size, 2);
  clock += GOOGLE_NONCE_TTL_MS + 1;
  auth.issueNonce(1);
  assert.equal(auth.size, 1);
  clock += GOOGLE_NONCE_TTL_MS + 1;
  assert.equal(auth.pruneNonces(), 1);
  assert.equal(auth.size, 0);
});
