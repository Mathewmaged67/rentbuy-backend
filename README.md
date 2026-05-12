# RentBuy Backend

Express + MySQL API server for the RentBuy marketplace.

## Prerequisites
- Node.js 18+
- MySQL 8+ running locally (or any accessible host)

## Setup

### 1. Configure environment
Edit `backend/.env`:
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=web_project
PORT=5000
JWT_SECRET=rentbuy_super_secret_jwt_key_change_in_production
NODE_ENV=development
```

### 2. Install dependencies
```bash
npm install
```

### 3. Initialize the database (first run only)
```bash
npm run setup
```
This creates the `web_project` database, all tables, and seeds initial products/categories.

### 4. Start the server
```bash
# Production mode
npm start

# Development mode (auto-restart on file changes — requires nodemon)
npm run dev
```

Server runs at **http://localhost:5000**

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register (returns token + user) |
| POST | `/api/auth/login` | — | Login (returns token + user) |
| GET | `/api/products` | — | List all products |
| GET | `/api/products/:id` | — | Get single product |
| POST | `/api/products` | seller/admin | Create product |
| PUT | `/api/products/:id` | seller/admin | Update product |
| DELETE | `/api/products/:id` | seller/admin | Delete product |
| GET | `/api/categories` | — | List categories |
| GET | `/api/profile` | customer+ | Get own profile |
| PUT | `/api/profile` | customer+ | Update name/email/phone/address |
| PUT | `/api/profile/password` | customer+ | Change password |
| GET | `/api/orders` | customer+ | Get own orders |
| POST | `/api/orders` | customer+ | Place an order |
| GET | `/api/admin/stats` | admin | Platform statistics |
