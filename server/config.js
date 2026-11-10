const path = require('path');

function loadConfig(overrides = {}) {
  const nodeEnv = overrides.nodeEnv || process.env.NODE_ENV || 'development';
  // A known development secret must never be usable by a deployed process.
  // Test runtimes get an explicit throwaway secret; every other environment
  // must supply its own JWT_SECRET.
  const fallbackSecret = nodeEnv === 'test' ? 'test-only-noughtline-secret' : '';
  const jwtSecret = overrides.jwtSecret || process.env.JWT_SECRET || fallbackSecret;
  const deploymentUrl = process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173';

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required');
  }
  if (nodeEnv !== 'test' && (jwtSecret.length < 32 || jwtSecret === 'replace-with-at-least-32-random-characters')) {
    throw new Error('JWT_SECRET must be a random value of at least 32 characters');
  }

  const databasePath = overrides.databasePath || process.env.DATABASE_PATH || path.join(__dirname, 'tic-tac.db');
  const ephemeralDatabase = /^\/tmp\//.test(databasePath);
  const paystackSecretKey = overrides.paystackSecretKey ?? process.env.PAYSTACK_SECRET_KEY ?? '';
  if (nodeEnv === 'production' && ephemeralDatabase) {
    console.warn('DATABASE_PATH is under /tmp; data will be lost on restart. Payments are disabled.');
  }

  return {
    nodeEnv,
    port: Number(overrides.port || process.env.PORT || 3000),
    jwtSecret,
    ephemeralDatabase,
    jwtExpiresIn: overrides.jwtExpiresIn || process.env.JWT_EXPIRES_IN || '30d',
    databasePath,
    staticDir: overrides.staticDir || process.env.STATIC_DIR || path.resolve(__dirname, '..', 'dist'),
    corsOrigins: (overrides.corsOrigins || process.env.CORS_ORIGINS || deploymentUrl)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    // Never take money against a database that will disappear on restart.
    paystackSecretKey: ephemeralDatabase ? '' : paystackSecretKey,
    googleClientId: overrides.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '',
    publicAppUrl: overrides.publicAppUrl || process.env.PUBLIC_APP_URL || deploymentUrl,
    roomActionRateLimit: Number(overrides.roomActionRateLimit || process.env.ROOM_ACTION_RATE_LIMIT || 30),
    roomActionRateWindowMs: Number(overrides.roomActionRateWindowMs || process.env.ROOM_ACTION_RATE_WINDOW_MS || 60_000),
    chatRateLimit: Number(overrides.chatRateLimit || process.env.CHAT_RATE_LIMIT || 12),
    chatRateWindowMs: Number(overrides.chatRateWindowMs || process.env.CHAT_RATE_WINDOW_MS || 30_000),
  };
}

module.exports = { loadConfig };
