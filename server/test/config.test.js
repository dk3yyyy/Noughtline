const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');

function withEnvironment(values, run) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('refuses to start without a JWT secret outside tests', () => {
  withEnvironment({ NODE_ENV: undefined, JWT_SECRET: undefined }, () => {
    assert.throws(() => loadConfig({ nodeEnv: 'development' }), /JWT_SECRET is required/);
  });
});

test('uses only the explicit test fallback secret in test runtimes', () => {
  withEnvironment({ NODE_ENV: 'test', JWT_SECRET: undefined }, () => {
    assert.equal(loadConfig().jwtSecret, 'test-only-noughtline-secret');
  });
});

test('disables payments when the database is on an ephemeral /tmp path', () => {
  const config = loadConfig({
    nodeEnv: 'production',
    jwtSecret: 'production-test-secret-at-least-32-characters',
    databasePath: '/tmp/noughtline.db',
    paystackSecretKey: 'sk_test_fake',
  });
  assert.equal(config.ephemeralDatabase, true);
  assert.equal(config.paystackSecretKey, '');
});

test('keeps payments enabled on a persistent database path', () => {
  const config = loadConfig({
    nodeEnv: 'production',
    jwtSecret: 'production-test-secret-at-least-32-characters',
    databasePath: '/var/data/noughtline.db',
    paystackSecretKey: 'sk_test_fake',
  });
  assert.equal(config.ephemeralDatabase, false);
  assert.equal(config.paystackSecretKey, 'sk_test_fake');
});

test('uses the Render external URL for same-origin production defaults', () => {
  withEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: 'render-test-secret-at-least-32-characters',
    RENDER_EXTERNAL_URL: 'https://noughtline.onrender.com',
    CORS_ORIGINS: undefined,
    PUBLIC_APP_URL: undefined,
  }, () => {
    const config = loadConfig();
    assert.deepEqual(config.corsOrigins, ['https://noughtline.onrender.com']);
    assert.equal(config.publicAppUrl, 'https://noughtline.onrender.com');
  });
});

test('explicit origin configuration takes precedence over Render defaults', () => {
  withEnvironment({
    NODE_ENV: 'production',
    JWT_SECRET: 'render-test-secret-at-least-32-characters',
    RENDER_EXTERNAL_URL: 'https://noughtline.onrender.com',
    CORS_ORIGINS: 'https://play.example.com,https://admin.example.com',
    PUBLIC_APP_URL: 'https://play.example.com',
  }, () => {
    const config = loadConfig();
    assert.deepEqual(config.corsOrigins, ['https://play.example.com', 'https://admin.example.com']);
    assert.equal(config.publicAppUrl, 'https://play.example.com');
  });
});
