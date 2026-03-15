const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const router  = express.Router();

// ── MIDDLEWARE: protect admin routes ──────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────
// Body: { password: string }
// Returns: { token: string, expiresIn: string }
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // In production the admin password hash is stored in an env var or DB.
    // On first run, hash the plain password from ADMIN_PASSWORD.
    // To generate a hash: node -e "require('bcryptjs').hash('yourpassword',12).then(console.log)"
    const storedHash = process.env.ADMIN_PASSWORD_HASH || '';

    // Fallback for initial setup: compare plain text (remove in production)
    let isValid = false;
    if (storedHash.startsWith('$2')) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // Plain text comparison — only for initial setup
      isValid = password === process.env.ADMIN_PASSWORD;
      if (isValid) {
        console.warn('[AUTH] WARNING: Using plain text password. Generate a hash and set ADMIN_PASSWORD_HASH.');
      }
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { role: 'admin', iat: Date.now() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /api/auth/verify ─────────────────────────────────────
// Verify a token is still valid (used by admin dashboard on load)
router.post('/verify', requireAuth, (req, res) => {
  res.json({ valid: true, admin: req.admin });
});

// ── POST /api/auth/hash-password ──────────────────────────────
// Utility: generate a bcrypt hash for a plain password
// Only available in development
router.post('/hash-password', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  const hash = await bcrypt.hash(password, 12);
  res.json({ hash, note: 'Set this as ADMIN_PASSWORD_HASH in your .env' });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
