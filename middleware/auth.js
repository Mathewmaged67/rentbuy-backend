const jwt = require('jsonwebtoken');

// Read lazily so this always reflects process.env regardless of require() order
const HARDCODED_SECRET = 'rentbuy_super_secret_jwt_key_change_in_production';
const getSecret = () => process.env.JWT_SECRET || HARDCODED_SECRET;



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
    const secret = getSecret();
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('[Auth] Verification failed:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ message: 'Token expired. Please login again.' });
    }
    return res.status(403).json({ message: 'Invalid token. Please login again.' });
  }


};

/**
 * Middleware factory to authorize specific roles
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'seller')
 */
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
    next();
  };
};

// JWT_SECRET exported as a getter so callers always get the live value
module.exports = {
  authenticateToken,
  authorizeRoles,
  get JWT_SECRET() { return getSecret(); },
};
