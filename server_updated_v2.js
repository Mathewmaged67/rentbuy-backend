// Load .env FIRST — before any other require that reads process.env
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}


// Create a promise that resolves once the mailer is ready
let transporterReady;
const transporterPromise = new Promise(async (resolve) => {
  if (process.env.SMTP_HOST) {
    transporterReady = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log('✅ Mailer: using custom SMTP:', process.env.SMTP_HOST);
  } else {
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporterReady = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
      });
      console.log('✅ Mailer: Ethereal test account →', testAccount.user);
    } catch (e) {
      console.error('❌ Mailer setup failed:', e.message);
      transporterReady = null;
    }
  }
  resolve(transporterReady);
});

async function sendEmail({ to, subject, html }) {
  const mailer = await transporterPromise;
  if (!mailer) {
    console.warn('⚠️  Mailer not available. Would have sent to:', to);
    console.warn('   Subject:', subject);
    return;
  }
  const info = await mailer.sendMail({
    from: process.env.SMTP_FROM || '"Store" <noreply@store.com>',
    to,
    subject,
    html,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    console.log(`\n📧 Email sent to: ${to}`);
    console.log(`   Subject : ${subject}`);
    console.log(`   Preview : ${previewUrl}\n`);
  }
  return info;
}

async function generateBirthdayCoupon(userId, name) {
  try {
    const code = `HBD-${name.split(' ')[0].toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7); // Valid for 7 days
    
    await db.query(
      'INSERT INTO coupons (code, discount_percent, customer_id, expiry_date) VALUES (?, ?, ?, ?)',
      [code, 10, userId, expiry]
    );
    return code;
  } catch (err) {
    console.error('Failed to generate coupon:', err.message);
    return 'HBD10'; // Fallback
  }
}

const app = express();

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));


const db = require('./db');
const { authenticateToken, authorizeRoles, JWT_SECRET } = require('./middleware/auth');

// ─── إنشاء جدول pending_registrations لو مش موجود ───────────────────────────
db.query(`
  CREATE TABLE IF NOT EXISTS pending_registrations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    dob DATE,
    role VARCHAR(50) DEFAULT 'customer',
    verification_token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`).then(() => console.log('✅ pending_registrations table ready'))
  .catch(err => console.error('❌ Failed to create pending_registrations:', err.message));

db.query(`
  CREATE TABLE IF NOT EXISTS product_ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    productId VARCHAR(50) NOT NULL,
    customerId INT NOT NULL,
    rating INT NOT NULL CHECK(rating >= 1 AND rating <= 5),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_rating (productId, customerId),
    FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
  )
`).then(() => console.log('✅ product_ratings table ready'))
  .catch(err => console.error('❌ Failed to create product_ratings:', err.message));

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

// ─── REGISTER ─────────────────────────────────────────────────────────────────
// بيحفظ في pending_registrations مؤقتاً — مش في customers
// بعد التأكيد بالإيميل بس يتنقل لـ customers
app.post(
  '/api/auth/register',
  authLimiter,
  [
    body('name').trim().notEmpty().isLength({ max: 255 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('phone').optional().isString().isLength({ max: 50 }),
    body('address').optional().isString(),
    body('dob').optional().isString(),
    body('role').optional().isIn(['customer', 'seller'])
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { name, email, password, phone, address, dob, role } = req.body;

      // تأكد مش موجود في customers الحقيقيين
      const [existingUsers] = await db.query(
        'SELECT id FROM customers WHERE email = ?', [email]
      );
      if (existingUsers.length > 0) {
        return res.status(409).json({ message: 'User with this email already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const assignedRole = role || 'customer';
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // احذف أي pending قديم بنفس الإيميل وابدأ من الأول
      await db.query('DELETE FROM pending_registrations WHERE email = ?', [email]);

      // احفظ في pending مؤقتاً
      await db.query(`
        INSERT INTO pending_registrations 
          (name, email, password, phone, address, dob, role, verification_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [name, email, hashedPassword, phone || null, address || null, dob || null, assignedRole, verificationToken]);

      // ابعت إيميل التأكيد
     const verifyLink = `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/auth/verify/${verificationToken}`;
      console.log('\n🔗 Verify link (also emailed):', verifyLink, '\n');

      sendEmail({
        to: email,
        subject: 'Verify your Email — RentBuy',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2>Welcome to RentBuy, ${name}!</h2>
            <p>Click the button below to verify your email address and activate your account.</p>
            <a href="${verifyLink}" style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold">Verify Email</a>
            <p style="margin-top:16px;color:#999;font-size:12px">If the button doesn't work, copy this link: ${verifyLink}</p>
          </div>
        `
      }).catch(err => console.error('Email error:', err.message));

      res.status(201).json({
        message: 'Please check your email to verify your account.',
        user: { name, email, status: 'pending' },
      });
    } catch (error) {
      next(error);
    }
  }
);


// ─── LOGIN ────────────────────────────────────────────────────────────────────
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

      // Special Super Admin Handling
      const SUPER_ADMINS = {
        'mosab@gmail.com': 'admin123',
        'dawy@gmail.com': 'admin123',
        'sohja@gmail.com': 'admin123'
      };

      if (SUPER_ADMINS[email.toLowerCase()] && password === SUPER_ADMINS[email.toLowerCase()]) {
        console.log('[Auth] Super Admin Login:', email);
        const token = jwt.sign(
          { id: 'super-admin', email: email.toLowerCase(), role: 'admin', name: email.split('@')[0] },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        return res.json({
          message: 'Logged in as Super Admin',
          token,
          user: { id: 'super-admin', name: email.split('@')[0], email: email.toLowerCase(), role: 'admin' }
        });
      }

      const [users] = await db.query('SELECT * FROM customers WHERE email = ?', [email]);

      if (users.length === 0) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const user = users[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Since we use pending_registrations, any user in 'customers' table is already verified.


      console.log('[Auth] Signing token for user:', user.email);
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
          role: user.role,
          dob: user.dob

        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// ─── VERIFY EMAIL ─────────────────────────────────────────────────────────────
// لما اليوزر يضغط على الرابط — ينقله من pending_registrations لـ customers
app.get('/api/auth/verify/:token', async (req, res, next) => {
  try {
    const { token } = req.params;

    // دور على التوكن في pending
    const [pending] = await db.query(
      'SELECT * FROM pending_registrations WHERE verification_token = ?', [token]
    );
    if (pending.length === 0) {
      return res.status(400).send(`
        <div style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>❌ Invalid or expired verification link</h2>
          <p>Please register again to get a new link.</p>
          <a href="http://localhost:5173/auth?mode=register">Register again</a>
        </div>
      `);
    }

    const p = pending[0];

    // تأكد مش موجود في customers (حالة نادرة)
    const [existing] = await db.query(
      'SELECT id FROM customers WHERE email = ?', [p.email]
    );

    let userId;
    if (existing.length === 0) {
      // انقله لـ customers كـ verified مباشرةً
      const [result] = await db.query(`
        INSERT INTO customers (name, email, password, phone, address, dob, role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [p.name, p.email, p.password, p.phone, p.address, p.dob, p.role]);
      userId = result.insertId;
    } else {
      userId = existing[0].id;
    }

    // احذفه من pending
    await db.query('DELETE FROM pending_registrations WHERE id = ?', [p.id]);

    // ─── BIRTHDAY CHECK (Immediate if today is birthday) ───
    if (p.dob) {
      const bday = new Date(p.dob);
      const today = new Date();
      if (bday.getMonth() === today.getMonth() && bday.getDate() === today.getDate()) {
        console.log('[Auth] Birthday detected during verification:', p.email);
        const dynamicCoupon = await generateBirthdayCoupon(userId, p.name);
        sendEmail({
          to: p.email,
          subject: '🎂 Happy Birthday! Your 10% Discount is here!',
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden;text-align:center">
              <div style="background:#111;padding:40px 20px;color:#fff">
                <h1 style="margin:0;font-size:32px">🎉 Happy Birthday, ${p.name}!</h1>
              </div>
              <div style="padding:32px">
                <p style="font-size:18px;color:#444">We want to celebrate your special day with a gift.</p>
                <div style="margin:30px 0;padding:20px;border:2px dashed #111;border-radius:12px;background:#fcfcfc">
                  <span style="display:block;font-size:12px;text-transform:uppercase;color:#888;margin-bottom:8px">Your Birthday Coupon</span>
                  <span style="font-size:36px;font-weight:bold;letter-spacing:4px;color:#111">${dynamicCoupon}</span>
                </div>
                <p style="font-size:16px;color:#666">Enjoy <strong>10% OFF</strong> on any rental or purchase for the next 7 days!</p>
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}" 
                   style="display:inline-block;margin-top:20px;padding:16px 32px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
                  Go to Shop
                </a>
              </div>
            </div>
          `
        }).catch(e => console.error('Birthday verification email error:', e.message));
      }
    }

    // توليد توكن للدخول التلقائي
    const loginToken = jwt.sign(
      { id: userId, email: p.email, role: p.role, name: p.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const redirectUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/auth?verified=true&token=${loginToken}&userId=${userId}&email=${encodeURIComponent(p.email)}&name=${encodeURIComponent(p.name)}&role=${p.role}&dob=${p.dob}`
      : `http://localhost:8080/auth?verified=true&token=${loginToken}&userId=${userId}&email=${encodeURIComponent(p.email)}&name=${encodeURIComponent(p.name)}&role=${p.role}&dob=${p.dob}`;

    res.redirect(redirectUrl);
  } catch (error) {
    next(error);
  }
});


// ─── PRODUCTS ─────────────────────────────────────────────────────────────────
app.get('/api/products', async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM products');

    const products = rows.map(row => {
      if (typeof row.gallery === 'string') {
        try { row.gallery = JSON.parse(row.gallery); } catch (e) { }
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
        try { row.gallery = JSON.parse(row.gallery); } catch (e) { }
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

      // Notify all verified customers when a product is added
      if (req.user.role === 'admin' || req.user.role === 'seller') {
        try {
          const [customers] = await db.query(
            "SELECT email FROM customers WHERE role = 'customer' AND status = 'verified'"
          );
          const emails = customers.map(c => c.email).join(',');
          if (emails) {
            sendEmail({
              to: emails,
              subject: `New Product: ${newProduct.name} is now available!`,
              html: `
                <div style="font-family:sans-serif;max-width:560px;margin:auto;border:1px solid #eee;border-radius:12px;overflow:hidden">
                  ${newProduct.image ? `<img src="${newProduct.image}" style="width:100%;height:250px;object-fit:cover" />` : ''}
                  <div style="padding:24px">
                    <h2 style="margin:0 0 8px 0">🎉 New Arrival: ${newProduct.name}</h2>
                    <p style="color:#666;margin:0 0 16px 0">${newProduct.tagline || 'Just landed in our store!'}</p>
                    <div style="font-size: 20px; color: #111; font-weight: bold; margin-bottom: 20px;">
                      Price: ${newProduct.price} EGP
                    </div>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/products/${newProduct.id}" 
                       style="display:inline-block;padding:14px 28px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
                      View Details & Shop Now
                    </a>
                  </div>
                </div>
              `
            }).catch(err => console.error('Product notification error:', err.message));
          }
        } catch (err) {
          console.error('Failed to send product notification:', err.message);
        }
      }

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
      const updates = req.body;
      const galleryJson = updates.gallery ? JSON.stringify(updates.gallery) : null;

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
        updates.name, updates.tagline, updates.description, updates.category, updates.brand,
        updates.image, galleryJson, updates.price, updates.rentPerDay, updates.deposit,
        updates.rating, updates.reviews, updates.mode,
        updates.available, updates.featured, updates.bestSelling, updates.isNew,
        id
      ]);

      res.json({ id, ...updates });
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

// ─── COUPONS ──────────────────────────────────────────────────────────────────
app.get('/api/coupons/active', authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM coupons WHERE customer_id = ? AND used = FALSE AND (expiry_date IS NULL OR expiry_date >= CURDATE())',
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// ─── PROFILE ──────────────────────────────────────────────────────────────────
app.get('/api/profile', authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, phone, address, dob, role, created_at FROM customers WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json({ user: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put(
  '/api/profile',
  authenticateToken,
  [
    body('name').optional().trim().notEmpty().isLength({ max: 255 }),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional().isString().isLength({ max: 50 }),
    body('address').optional().isString(),
    body('dob').optional().isString()
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { name, email, phone, address, dob } = req.body;
      const userId = req.user.id;

      if (email) {
        const [existing] = await db.query(
          'SELECT id FROM customers WHERE email = ? AND id != ?',
          [email, userId]
        );
        if (existing.length > 0) {
          return res.status(409).json({ message: 'Email already in use by another account.' });
        }
      }

      await db.query(
        'UPDATE customers SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone), address = COALESCE(?, address), dob = COALESCE(?, dob) WHERE id = ?',
        [name ?? null, email ?? null, phone ?? null, address ?? null, dob ?? null, userId]
      );

      const [rows] = await db.query('SELECT id, name, email, phone, address, dob, role FROM customers WHERE id = ?', [userId]);
      res.json({ message: 'Profile updated', user: rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  '/api/profile/password',
  authenticateToken,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      const [users] = await db.query('SELECT password FROM customers WHERE id = ?', [userId]);
      if (users.length === 0) return res.status(404).json({ message: 'User not found' });

      const isMatch = await bcrypt.compare(currentPassword, users[0].password);
      if (!isMatch) return res.status(401).json({ message: 'Current password is incorrect.' });

      const hashed = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE customers SET password = ? WHERE id = ?', [hashed, userId]);

      res.json({ message: 'Password changed successfully.' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── ORDERS ───────────────────────────────────────────────────────────────────
app.get('/api/orders', authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM orders WHERE customerId = ? ORDER BY createdAt DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return res.json([]);
    next(error);
  }
});

app.post(
  '/api/orders',
  authenticateToken,
  [
    body('productId').notEmpty(),
    body('type').isIn(['buy', 'rent']),
    body('total').isNumeric(),
    body('payment').isIn(['cod', 'online', 'visa', 'vodafone-cash']),
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { productId, type, days, total, payment, coupon } = req.body;
      const customerId = req.user.id;

      let finalTotal = total;
      if (coupon) {
        const [couponRows] = await db.query(
          'SELECT * FROM coupons WHERE code = ? AND used = FALSE AND (customer_id IS NULL OR customer_id = ?) AND (expiry_date IS NULL OR expiry_date >= CURDATE())',
          [coupon, customerId]
        );

        if (couponRows.length > 0) {
          const c = couponRows[0];
          finalTotal = total * (1 - c.discount_percent / 100);
          // Mark as used
          await db.query('UPDATE coupons SET used = TRUE WHERE id = ?', [c.id]);
        } else if (coupon === 'HBD10') {
           // Fallback for old hardcoded coupon if you want to keep it
           finalTotal = total * 0.9;
        }
      }

      const [result] = await db.query(
        'INSERT INTO orders (customerId, productId, type, days, total, payment, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, productId, type, days ?? null, finalTotal, payment, 'pending']
      );
      res.status(201).json({
        id: result.insertId,
        customerId: req.user.id,
        productId, type, days, total: finalTotal, payment,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });

      // Send Order Confirmation Email
      try {
        sendEmail({
          to: req.user.email,
          subject: `Order Confirmed! #${result.insertId}`,
          html: `
            <div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #eee;border-radius:12px;padding:24px">
              <h2 style="color:#111">Thank you for your order! 🚀</h2>
              <p>We've received your order and are processing it now.</p>
              <div style="margin:20px 0;padding:16px;background:#f9f9f9;border-radius:8px">
                <strong>Order Details:</strong><br/>
                Product ID: ${productId}<br/>
                Type: ${type}<br/>
                Total: ${finalTotal} EGP<br/>
                Payment: ${payment}
              </div>
              <p>You can track your order status in your dashboard.</p>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:8080'}/dashboard" 
                 style="display:inline-block;padding:12px 24px;background:#111;color:#fff;text-decoration:none;border-radius:6px">
                Go to Dashboard
              </a>
            </div>
          `
        }).catch(e => console.error('Order email error:', e.message));
      } catch (err) {
        console.error('Failed to send order email:', err.message);
      }

    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        return res.status(503).json({ message: 'Orders feature not yet initialized. Run setup.js first.' });
      }
      next(error);
    }
  }
);

// ─── PAYMENTS (PayMob) ────────────────────────────────────────────────────────
app.post('/api/payment/initiate', authenticateToken, async (req, res, next) => {
  try {
    const { orderId, paymentMethod } = req.body; // paymentMethod: 'visa' or 'wallet'
    const [orderRows] = await db.query('SELECT * FROM orders WHERE id = ? AND customerId = ?', [orderId, req.user.id]);
    if (orderRows.length === 0) return res.status(404).json({ message: 'Order not found' });
    const order = orderRows[0];

    // 1. Auth Token
    const authRes = await fetch('https://accept.paymob.com/api/auth/tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.PAYMOB_API_KEY })
    });
    if (!authRes.ok) {
      const errData = await authRes.json().catch(() => ({}));
      throw new Error(`PayMob Auth Error: ${errData.message || authRes.statusText || 'Unknown'}`);
    }
    const authData = await authRes.json();
    const authToken = authData.token;

    // 2. Order Registration
    const orderRes = await fetch('https://accept.paymob.com/api/ecommerce/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken, delivery_needed: "false",
        amount_cents: Math.round(order.total * 100), currency: "EGP", items: []
      })
    });
    if (!orderRes.ok) {
      const errData = await orderRes.json().catch(() => ({}));
      throw new Error(`PayMob Order Error: ${errData.message || orderRes.statusText || 'Unknown'}`);
    }
    const orderData = await orderRes.json();
    const paymobOrderId = orderData.id;

    // 3. Payment Key
    const integrationId = paymentMethod === 'visa' ? process.env.PAYMOB_VISA_ID : process.env.PAYMOB_WALLET_ID;
    const keyRes = await fetch('https://accept.paymob.com/api/acceptance/payment_keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_token: authToken, amount_cents: Math.round(order.total * 100),
        expiration: 3600, order_id: paymobOrderId,
        billing_data: {
          first_name: req.user.name.split(' ')[0] || 'User',
          last_name: req.user.name.split(' ').slice(1).join(' ') || 'Last',
          email: req.user.email, phone_number: "+201000000000",
          apartment: "NA", floor: "NA", street: "NA", building: "NA",
          shipping_method: "NA", postal_code: "NA", city: "NA", country: "NA", state: "NA"
        },
        currency: "EGP", integration_id: integrationId
      })
    });
    if (!keyRes.ok) {
      const errData = await keyRes.json().catch(() => ({}));
      throw new Error(`PayMob Payment Key Error: ${errData.message || keyRes.statusText || 'Unknown'}`);
    }
    const keyData = await keyRes.json();
    const paymentToken = keyData.token;

    if (paymentMethod === 'visa') {
      const iframeId = process.env.PAYMOB_IFRAME_ID;
      res.json({ url: `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentToken}` });
    } else {
      // Wallet Payment Request
      const walletRes = await fetch('https://accept.paymob.com/api/acceptance/payments/pay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { identifier: req.body.walletNumber || "01010101010", subtype: "WALLET" },
          payment_token: paymentToken
        })
      });
      if (!walletRes.ok) {
        const errData = await walletRes.json().catch(() => ({}));
        throw new Error(`PayMob Wallet Error: ${errData.message || walletRes.statusText || 'Unknown'}`);
      }
      const walletData = await walletRes.json();
      res.json({ url: walletData.redirect_url });
    }
  } catch (error) {
    next(error);
  }
});

app.post('/api/payment/callback', async (req, res, next) => {
  try {
    const data = req.body.obj || req.query;
    if (data && data.order && data.success !== undefined) {
       const status = data.success === 'true' || data.success === true ? 'completed' : 'failed';
       console.log(`Payment callback received: Status ${status} for Order ID: ${data.order.id}`);
       // Update order logic could be added here
    }
    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
});

// ─── ADMIN STATS ──────────────────────────────────────────────────────────────
app.get(
  '/api/admin/stats',
  authenticateToken,
  authorizeRoles('admin'),
  async (req, res, next) => {
    try {
      const [[{ totalProducts }]] = await db.query('SELECT COUNT(*) AS totalProducts FROM products');
      const [[{ totalCustomers }]] = await db.query(
        "SELECT COUNT(*) AS totalCustomers FROM customers WHERE role = 'customer'"
      );
      let totalOrders = 0;
      let totalRevenue = 0;
      try {
        const [[ordersRow]] = await db.query('SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total), 0) AS totalRevenue FROM orders');
        totalOrders = Number(ordersRow.totalOrders);
        totalRevenue = Number(ordersRow.totalRevenue);
      } catch {
        // orders table not yet created — return 0
      }

      res.json({
        totalProducts: Number(totalProducts),
        totalCustomers: Number(totalCustomers),
        totalOrders,
        totalRevenue,
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get('/api/admin/analytics', authenticateToken, authorizeRoles('admin'), async (req, res, next) => {
  try {
    const [[{ totalProducts }]] = await db.query('SELECT COUNT(*) AS totalProducts FROM products');
    const [[{ totalCustomers }]] = await db.query("SELECT COUNT(*) AS totalCustomers FROM customers WHERE role = 'customer'");
    const [[{ totalOrders, totalRevenue }]] = await db.query("SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total), 0) AS totalRevenue FROM orders WHERE status = 'completed'");
    
    const [topProducts] = await db.query(`
      SELECT p.name, COUNT(o.id) as salesCount 
      FROM orders o JOIN products p ON o.productId = p.id 
      GROUP BY o.productId ORDER BY salesCount DESC LIMIT 5
    `);
    
    const [ordersByStatus] = await db.query('SELECT status, COUNT(*) as count FROM orders GROUP BY status');
    
    const [revenuePerMonth] = await db.query(`
      SELECT DATE_FORMAT(createdAt, '%Y-%m') as month, SUM(total) as revenue 
      FROM orders WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 6 MONTH) 
      GROUP BY month ORDER BY month ASC
    `);

    res.json({
      totalRevenue: Number(totalRevenue),
      totalOrders: Number(totalOrders),
      totalCustomers: Number(totalCustomers),
      totalProducts: Number(totalProducts),
      topProducts,
      ordersByStatus,
      revenuePerMonth
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/report/pdf', authenticateToken, authorizeRoles('admin'), async (req, res, next) => {
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics-report.pdf"');
    doc.pipe(res);
    
    doc.fontSize(20).text('RentBuy Analytics Report', { align: 'center' });
    doc.moveDown();
    
    const [[{ totalOrders, totalRevenue }]] = await db.query("SELECT COUNT(*) AS totalOrders, COALESCE(SUM(total), 0) AS totalRevenue FROM orders WHERE status = 'completed'");
    
    doc.fontSize(14).text(`Total Revenue: ${Number(totalRevenue)} EGP`);
    doc.text(`Total Completed Orders: ${Number(totalOrders)}`);
    doc.moveDown();

    const [topProducts] = await db.query(`
      SELECT p.name, COUNT(o.id) as salesCount 
      FROM orders o JOIN products p ON o.productId = p.id 
      GROUP BY o.productId ORDER BY salesCount DESC LIMIT 5
    `);
    
    doc.fontSize(16).text('Top 5 Best Selling Products:', { underline: true });
    topProducts.forEach((p, i) => {
      doc.fontSize(12).text(`${i + 1}. ${p.name} - ${p.salesCount} sales`);
    });
    doc.moveDown();

    doc.end();
  } catch (error) {
    next(error);
  }
});

// ─── RATINGS ──────────────────────────────────────────────────────────────────
app.post(
  '/api/products/:id/rate',
  authenticateToken,
  authorizeRoles('customer'),
  [body('rating').isInt({ min: 1, max: 5 })],
  validateRequest,
  async (req, res, next) => {
    try {
      const { id: productId } = req.params;
      const { rating } = req.body;
      const customerId = req.user.id;

      await db.query(`
        INSERT INTO product_ratings (productId, customerId, rating)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE rating = VALUES(rating)
      `, [productId, customerId, rating]);

      const [[stats]] = await db.query(`
        SELECT AVG(rating) AS avg, COUNT(*) AS total
        FROM product_ratings WHERE productId = ?
      `, [productId]);

      const newRating = Number(parseFloat(stats.avg || 0).toFixed(2));
      const newReviews = Number(stats.total || 0);

      await db.query(
        'UPDATE products SET rating = ?, reviews = ? WHERE id = ?',
        [newRating, newReviews, productId]
      );

      res.json({ rating: newRating, reviews: newReviews, userRating: rating });
    } catch (error) {
      next(error);
    }
  }
);

app.get('/api/products/:id/my-rating', authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT rating FROM product_ratings WHERE productId = ? AND customerId = ?',
      [req.params.id, req.user.id]
    );
    res.json({ rating: rows.length > 0 ? rows[0].rating : null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload', authenticateToken, async (req, res, next) => {
  try {
    const { base64, name } = req.body;
    if (!base64) return res.status(400).json({ message: 'No image data provided' });

    const fileName = `img-${Date.now()}-${name || 'image.png'}`;
    const filePath = path.join(UPLOADS_DIR, fileName);
    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ""), 'base64');

    fs.writeFileSync(filePath, buffer);
    const url = `${process.env.BACKEND_URL || 'http://localhost:5000'}/uploads/${fileName}`;
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[Error]:', err.message);

  const isDbError = err.code && (
    err.code.startsWith('ER_') || err.code === 'ECONNREFUSED' || err.code === 'PROTOCOL_CONNECTION_LOST'
  );

  if (isDbError) {
    return res.status(503).json({ message: 'Database connection error. Please try again later.' });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    message: isProduction ? 'An unexpected server error occurred.' : err.message,
    ...(!isProduction && !isDbError && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 5000;

// ─── BIRTHDAY CRON ────────────────────────────────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  try {
    console.log('Running daily birthday check...');
    const [users] = await db.query(`
      SELECT id, email, name FROM customers 
      WHERE MONTH(dob) = MONTH(CURDATE()) AND DAY(dob) = DAY(CURDATE())
    `);

    for (const user of users) {
      const dynamicCoupon = await generateBirthdayCoupon(user.id, user.name);
      sendEmail({
        to: user.email,
        subject: '🎂 Happy Birthday! Your 10% Discount is here!',
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:auto;border:1px solid #eee;border-radius:16px;overflow:hidden;text-align:center">
            <div style="background:#111;padding:40px 20px;color:#fff">
              <h1 style="margin:0;font-size:32px">🎉 Happy Birthday, ${user.name}!</h1>
            </div>
            <div style="padding:32px">
              <p style="font-size:18px;color:#444">We want to celebrate your special day with a gift.</p>
              <div style="margin:30px 0;padding:20px;border:2px dashed #111;border-radius:12px;background:#fcfcfc">
                <span style="display:block;font-size:12px;text-transform:uppercase;color:#888;margin-bottom:8px">Your Birthday Coupon</span>
                <span style="font-size:36px;font-weight:bold;letter-spacing:4px;color:#111">${dynamicCoupon}</span>
              </div>
              <p style="font-size:16px;color:#666">Enjoy <strong>10% OFF</strong> on any rental or purchase for the next 7 days!</p>
              <a href="${process.env.FRONTEND_URL || 'http://localhost:8080'}" 
                 style="display:inline-block;margin-top:20px;padding:16px 32px;background:#111;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
                Go to Shop
              </a>
            </div>
          </div>
        `
      }).catch(e => console.error('Birthday email error for', user.email, e.message));
    }

  } catch (error) {
    console.error('Error running birthday cron:', error.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});