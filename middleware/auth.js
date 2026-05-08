const jwt = require('jsonwebtoken');

// Secret key for JWT (in production, use process.env.JWT_SECRET)
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-development-key';

/**
 * Middleware to verify JWT token and authenticate user
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  // Token is typically sent as "Bearer [token]"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Attach user info (id, role, etc.) to request
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid or expired token.' });
  }
};

/**
 * Middleware factory to authorize specific roles
 * @param {Array<string>} roles - Allowed roles (e.g., ['admin', 'seller'])
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

module.exports = {
  authenticateToken,
  authorizeRoles,
  JWT_SECRET
};
