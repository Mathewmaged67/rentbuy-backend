const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

const db = require('./db');
const { authenticateToken, authorizeRoles, JWT_SECRET } = require('./middleware/auth');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts from this IP, please try again later.'
});

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }
  next();
};

app.post(
  '/api/auth/register',
  authLimiter,
  [
    body('name').trim().notEmpty().isLength({ max: 255 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('phone').optional().isString().isLength({ max: 50 }),
    body('address').optional().isString(),
    body('role').optional().isIn(['customer', 'seller'])
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { name, email, password, phone, address, role } = req.body;
      const [existingUsers] = await db.query('SELECT id FROM customers WHERE email = ?', [email]);
      if (existingUsers.length > 0) {
        return res.status(409).json({ message: 'User with this email already exists' });
      }

      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const assignedRole = role || 'customer';

      const [result] = await db.query(`
        INSERT INTO customers (name, email, password, phone, address, role)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [name, email, hashedPassword, phone, address, assignedRole]);

      res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/api/auth/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const [users] = await db.query('SELECT * FROM customers WHERE email = ?', [email]);
      if (users.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const user = users[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role, name: user.name },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        message: 'Logged in successfully',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get('/api/products', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM products');
    const products = rows.map(row => {
      if (typeof row.gallery === 'string') {
        try { row.gallery = JSON.parse(row.gallery); } catch (e) {}
      }
      row.available = !!row.available;
      row.featured = !!row.featured;
      row.bestSelling = !!row.bestSelling;
      row.isNew = !!row.isNew;
      if (row.rating) row.rating = Number(row.rating);
      if (row.price) row.price = Number(row.price);
      if (row.rentPerDay) row.rentPerDay = Number(row.rentPerDay);
      if (row.deposit) row.deposit = Number(row.deposit);
      if (row.reviews) row.reviews = Number(row.reviews);
      return row;
    });
    res.json(products);
  } catch (error) {
    next(error);
  }
});

app.get('/api/products/:id', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      const row = rows[0];
      if (typeof row.gallery === 'string') {
        try { row.gallery = JSON.parse(row.gallery); } catch (e) {}
      }
      row.available = !!row.available;
      row.featured = !!row.featured;
      row.bestSelling = !!row.bestSelling;
      row.isNew = !!row.isNew;
      if (row.rating) row.rating = Number(row.rating);
      if (row.price) row.price = Number(row.price);
      if (row.rentPerDay) row.rentPerDay = Number(row.rentPerDay);
      if (row.deposit) row.deposit = Number(row.deposit);
      if (row.reviews) row.reviews = Number(row.reviews);
      res.json(row);
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/products',
  authenticateToken,
  authorizeRoles('admin', 'seller'),
  [
    body('name').notEmpty(),
    body('price').isNumeric(),
    body('category').notEmpty()
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const newProduct = { ...req.body, id: `p-${Date.now()}` };
      const galleryJson = JSON.stringify(newProduct.gallery || []);
      const sellerId = `s-${req.user.id}`; 
      const sellerName = req.user.name;

      await db.query(`
        INSERT INTO products (id, name, tagline, description, category, brand, image, gallery, price, rentPerDay, deposit, rating, reviews, mode, available, featured, bestSelling, isNew, sellerId, sellerName)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        newProduct.id, newProduct.name, newProduct.tagline, newProduct.description, newProduct.category, 
        newProduct.brand, newProduct.image, galleryJson, newProduct.price, newProduct.rentPerDay, 
        newProduct.deposit, newProduct.rating, newProduct.reviews, newProduct.mode, 
        newProduct.available, newProduct.featured, newProduct.bestSelling, newProduct.isNew, 
        sellerId, sellerName
      ]);
      res.status(201).json({ ...newProduct, sellerId, sellerName });
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  '/api/products/:id',
  authenticateToken,
  authorizeRoles('admin', 'seller'),
  [
    body('name').optional().notEmpty(),
    body('price').optional().isNumeric()
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const body = req.body;
      const galleryJson = body.gallery ? JSON.stringify(body.gallery) : null;

      if (req.user.role !== 'admin') {
        const [existing] = await db.query('SELECT sellerId FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
          return res.status(404).json({ message: 'Product not found' });
        }
        if (existing[0].sellerId !== `s-${req.user.id}`) {
          return res.status(403).json({ message: 'Access denied.' });
        }
      }

      await db.query(`
        UPDATE products 
        SET name=?, tagline=?, description=?, category=?, brand=?, image=?, gallery=?, price=?, rentPerDay=?, deposit=?, rating=?, reviews=?, mode=?, available=?, featured=?, bestSelling=?, isNew=?
        WHERE id=?
      `, [
        body.name, body.tagline, body.description, body.category, body.brand, body.image, galleryJson, 
        body.price, body.rentPerDay, body.deposit, body.rating, body.reviews, body.mode, 
        body.available, body.featured, body.bestSelling, body.isNew,
        id
      ]);
      
      res.json({ id, ...body });
    } catch (error) {
      next(error);
    }
  }
);

app.delete(
  '/api/products/:id',
  authenticateToken,
  authorizeRoles('admin', 'seller'),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (req.user.role !== 'admin') {
        const [existing] = await db.query('SELECT sellerId FROM products WHERE id = ?', [id]);
        if (existing.length === 0) {
          return res.status(404).json({ message: 'Product not found' });
        }
        if (existing[0].sellerId !== `s-${req.user.id}`) {
          return res.status(403).json({ message: 'Access denied.' });
        }
      }

      const [result] = await db.query('DELETE FROM products WHERE id = ?', [id]);
      if (result.affectedRows > 0) {
        res.json({ message: 'Product deleted successfully' });
      } else {
        res.status(404).json({ message: 'Product not found' });
      }
    } catch (error) {
      next(error);
    }
  }
);

app.get('/api/categories', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.use((err, req, res, next) => {
  console.error('[Error]:', err.message);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    message: isProduction ? 'An unexpected server error occurred.' : err.message,
    ...( !isProduction && { stack: err.stack } )
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});