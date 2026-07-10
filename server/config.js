const path = require('path');

function loadConfig(overrides = {}) {
  const nodeEnv = overrides.nodeEnv || process.env.NODE_ENV || 'development';
  const jwtSecret = overrides.jwtSecret || process.env.JWT_SECRET || (nodeEnv === 'production' ? '' : 'development-only-change-me');

  if (!jwtSecret) {
    throw new Error('JWT_SECRET is required in production');
  }

  return {
    nodeEnv,
    port: Number(overrides.port || process.env.PORT || 3000),
    jwtSecret,
    jwtExpiresIn: overrides.jwtExpiresIn || process.env.JWT_EXPIRES_IN || '30d',
    databasePath: overrides.databasePath || process.env.DATABASE_PATH || path.join(__dirname, 'tic-tac.db'),
    staticDir: overrides.staticDir || process.env.STATIC_DIR || path.resolve(__dirname, '..', 'dist'),
    corsOrigins: (overrides.corsOrigins || process.env.CORS_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    paystackSecretKey: overrides.paystackSecretKey ?? process.env.PAYSTACK_SECRET_KEY ?? '',
    publicAppUrl: overrides.publicAppUrl || process.env.PUBLIC_APP_URL || 'http://localhost:5173',
    roomActionRateLimit: Number(overrides.roomActionRateLimit || process.env.ROOM_ACTION_RATE_LIMIT || 30),
    roomActionRateWindowMs: Number(overrides.roomActionRateWindowMs || process.env.ROOM_ACTION_RATE_WINDOW_MS || 60_000),
  };
}

module.exports = { loadConfig };
