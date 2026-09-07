import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleIdConfig,
  isGoogleEnabled,
  loadGsiScript,
  normalizeGoogleError,
  parseProviderResponse,
  resetGsiScriptLoader,
  signInAvailability,
} from '../src/services/google.js';

// --- parseProviderResponse ---

test('parseProviderResponse returns true when the server reports google configured', () => {
  assert.equal(parseProviderResponse({ google: { configured: true } }), true);
});

test('parseProviderResponse returns false when google is reported unconfigured', () => {
  assert.equal(parseProviderResponse({ google: { configured: false } }), false);
});

test('parseProviderResponse treats a loose truthy configured value as false', () => {
  assert.equal(parseProviderResponse({ google: { configured: 'true' } }), false);
});

test('parseProviderResponse treats missing, empty or malformed payloads as unconfigured', () => {
  assert.equal(parseProviderResponse(undefined), false);
  assert.equal(parseProviderResponse(null), false);
  assert.equal(parseProviderResponse({}), false);
  assert.equal(parseProviderResponse({ google: null }), false);
  assert.equal(parseProviderResponse({ google: 'yes' }), false);
  assert.equal(parseProviderResponse('nope'), false);
});

// --- isGoogleEnabled ---

test('isGoogleEnabled requires both provider configuration and a client id', () => {
  assert.equal(isGoogleEnabled(true, 'abc.apps.googleusercontent.com'), true);
  assert.equal(isGoogleEnabled(false, 'abc.apps.googleusercontent.com'), false);
  assert.equal(isGoogleEnabled(true, ''), false);
  assert.equal(isGoogleEnabled(true, '   '), false);
  assert.equal(isGoogleEnabled(true, undefined), false);
  assert.equal(isGoogleEnabled(true, null), false);
  assert.equal(isGoogleEnabled(true, 123), false);
});

// --- buildGoogleIdConfig ---

test('buildGoogleIdConfig returns the GIS IdConfiguration with a per-attempt nonce', () => {
  const callback = () => {};
  assert.deepEqual(
    buildGoogleIdConfig({ clientId: 'abc.apps.googleusercontent.com', nonce: 'n-1', callback }),
    { client_id: 'abc.apps.googleusercontent.com', nonce: 'n-1', callback, auto_select: false },
  );
});

test('buildGoogleIdConfig returns null when any required input is missing', () => {
  const callback = () => {};
  assert.equal(buildGoogleIdConfig({ clientId: '', nonce: 'n-1', callback }), null);
  assert.equal(buildGoogleIdConfig({ clientId: undefined, nonce: 'n-1', callback }), null);
  assert.equal(buildGoogleIdConfig({ clientId: 'abc', nonce: '', callback }), null);
  assert.equal(buildGoogleIdConfig({ clientId: 'abc', nonce: undefined, callback }), null);
  assert.equal(buildGoogleIdConfig({ clientId: 'abc', nonce: 'n-1', callback: null }), null);
});

// --- normalizeGoogleError ---

test('normalizeGoogleError surfaces the server error verbatim with its code', () => {
  const result = normalizeGoogleError({
    response: { status: 409, data: { code: 'GOOGLE_LINK_CONFLICT', error: 'Export your data and delete the linked account first.' } },
  });
  assert.deepEqual(result, {
    message: 'Export your data and delete the linked account first.',
    code: 'GOOGLE_LINK_CONFLICT',
    status: 409,
    canceled: false,
  });
});

test('normalizeGoogleError prefers body.error, then body.message', () => {
  const withMessage = normalizeGoogleError({ response: { status: 401, data: { code: 'INVALID_NONCE', message: 'Nonce expired' } } });
  assert.equal(withMessage.message, 'Nonce expired');
  assert.equal(withMessage.code, 'INVALID_NONCE');
});

test('normalizeGoogleError falls back per status when the body has no message', () => {
  assert.equal(normalizeGoogleError({ response: { status: 401, data: {} } }).message, "Google couldn't verify this sign-in. Please try again.");
  assert.equal(normalizeGoogleError({ response: { status: 409, data: {} } }).message, 'This Google account is already linked to a different Noughtline account.');
  assert.equal(normalizeGoogleError({ response: { status: 503, data: {} } }).message, "Google sign-in isn't configured on the server yet.");
  assert.equal(normalizeGoogleError({ response: { status: 500, data: {} } }).message, 'Account linking failed. Please try again.');
});

test('normalizeGoogleError handles a non-object body and a missing status mapping', () => {
  assert.equal(normalizeGoogleError({ response: { status: 418, data: 'teapot' } }).message, 'Account linking failed. Please try again.');
});

test('normalizeGoogleError maps axios network failures to a friendly transport message', () => {
  assert.equal(normalizeGoogleError({ message: 'Network Error' }).message, 'Could not reach the server. Check your connection and try again.');
  assert.equal(normalizeGoogleError({ message: 'timeout of 10000ms exceeded' }).message, 'Could not reach the server. Check your connection and try again.');
});

test('normalizeGoogleError passes local (non-transport) error messages through verbatim', () => {
  assert.equal(
    normalizeGoogleError(new Error('Google sign-in is unavailable in this browser.')).message,
    'Google sign-in is unavailable in this browser.',
  );
});

test('normalizeGoogleError flags aborted requests as canceled without a message', () => {
  assert.deepEqual(normalizeGoogleError({ code: 'ERR_CANCELED' }), { message: '', code: 'ERR_CANCELED', status: 0, canceled: true });
});

// --- loadGsiScript (fake-document, no real DOM) ---

function createFakeDocument({ googlePresent = false } = {}) {
  const scripts = [];
  const doc = {
    scripts,
    head: {
      appendChild: (node) => scripts.push(node),
      removeChild: (node) => {
        const index = scripts.indexOf(node);
        if (index !== -1) scripts.splice(index, 1);
      },
    },
    createElement: (tag) => ({ tagName: tag, id: null, src: '', async: false }),
  };
  doc.defaultView = googlePresent ? { google: { accounts: { id: {} } } } : {};
  return doc;
}

test('loadGsiScript resolves immediately when the GIS client is already present', async () => {
  resetGsiScriptLoader();
  const doc = createFakeDocument({ googlePresent: true });
  await loadGsiScript(doc);
  assert.equal(doc.scripts.length, 0, 'no script injected when google.accounts.id already exists');
});

test('loadGsiScript injects the script once and resolves when it loads', async () => {
  resetGsiScriptLoader();
  const doc = createFakeDocument();
  const loaded = loadGsiScript(doc);
  assert.equal(doc.scripts.length, 1);
  assert.equal(doc.scripts[0].id, 'google-gsi-client');
  assert.equal(doc.scripts[0].src, 'https://accounts.google.com/gsi/client');
  assert.equal(doc.scripts[0].async, true);
  doc.scripts[0].onload();
  await loaded;
});

test('loadGsiScript rejects on load error, removes the dead node and permits a later retry', async () => {
  resetGsiScriptLoader();
  const doc = createFakeDocument();
  const first = loadGsiScript(doc);
  const failedNode = doc.scripts[0];
  failedNode.onerror();
  await assert.rejects(first, /could not be loaded/);
  assert.equal(doc.scripts.length, 0, 'the failed script node is removed from the DOM');
  // The failed attempt must not poison future attempts: a retry re-injects a
  // brand-new script instead of resolving against the dead tag.
  const second = loadGsiScript(doc);
  assert.equal(doc.scripts.length, 1);
  assert.notEqual(doc.scripts[0], failedNode);
  doc.scripts[0].onload();
  await second;
});

test('loadGsiScript shares one in-flight promise for concurrent callers', async () => {
  resetGsiScriptLoader();
  const doc = createFakeDocument();
  const first = loadGsiScript(doc);
  const second = loadGsiScript(doc);
  assert.equal(first, second, 'concurrent loads share the same promise');
  assert.equal(doc.scripts.length, 1);
  doc.scripts[0].onload();
  await first;
});

// --- signInAvailability ---

test('signInAvailability reports enabled only when configured and a client id is compiled in', () => {
  assert.equal(signInAvailability({ configured: true, loaded: true, clientId: 'x.apps.googleusercontent.com' }), 'enabled');
  assert.equal(signInAvailability({ configured: false, loaded: true, clientId: 'x.apps.googleusercontent.com' }), 'unconfigured');
  assert.equal(signInAvailability({ configured: true, loaded: true, clientId: '' }), 'unconfigured');
  assert.equal(signInAvailability({ configured: true, loaded: true, clientId: '   ' }), 'unconfigured');
});

test('signInAvailability reports unknown before the providers endpoint resolves', () => {
  // The initial state: no fetch result yet. Clicking must not claim
  // 'unconfigured' during this window (cold start / slow first load).
  assert.equal(signInAvailability({ configured: false, loaded: false, clientId: 'x' }), 'unknown');
  assert.equal(signInAvailability({ configured: false, loaded: false, clientId: '' }), 'unknown');
});

test('signInAvailability treats a failed providers fetch as loaded-unconfigured', () => {
  assert.equal(signInAvailability({ configured: false, loaded: true, clientId: 'x' }), 'unconfigured');
});
