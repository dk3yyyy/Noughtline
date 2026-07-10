const jwt = require('jsonwebtoken');

function createAuth({ db, config }) {
  function signUser(user) {
    return jwt.sign(
      { sub: String(user.id), type: 'access', sv: user.session_version || 0 },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn, issuer: 'tic-tac-api', audience: 'tic-tac-client' },
    );
  }

  function verifyToken(token) {
    const payload = jwt.verify(token, config.jwtSecret, {
      issuer: 'tic-tac-api',
      audience: 'tic-tac-client',
    });
    if (payload.type !== 'access') throw new Error('Invalid token type');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
    if (!user || (user.session_version || 0) !== (payload.sv || 0)) throw new Error('Session revoked');
    return user;
  }

  function bearerToken(req) {
    const [scheme, token] = String(req.headers.authorization || '').split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }

  function requireAuth(req, res, next) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ error: 'Authentication required' });
      req.user = verifyToken(token);
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
  }

  function authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      socket.user = verifyToken(token);
      return next();
    } catch {
      return next(new Error('Invalid or expired session'));
    }
  }

  return { signUser, verifyToken, requireAuth, authenticateSocket };
}

module.exports = { createAuth };
