const jwt = require('jsonwebtoken');

// A known fallback secret is acceptable only on a developer machine. Refuse
// to start a production server without a real secret so sessions cannot be
// forged after deployment.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production');
}
const JWT_SECRET = process.env.JWT_SECRET || 'resqora_development_only_change_me';

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid token format' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Attaches req.user when a valid token happens to be present, but never
 * rejects. Lets a public endpoint tailor its answer to the caller.
 */
function optionalAuth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      // An expired or bogus token is simply an anonymous caller here.
    }
  }
  next();
}

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
}

module.exports = { authMiddleware, optionalAuth, generateToken, JWT_SECRET };
