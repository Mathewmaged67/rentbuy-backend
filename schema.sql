CREATE DATABASE IF NOT EXISTS web_project;
USE web_project;

CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    tagline VARCHAR(255),
    description TEXT,
    category VARCHAR(100),
    brand VARCHAR(100),
    image VARCHAR(255),
    gallery JSON,
    price DECIMAL(10, 2),
    rentPerDay DECIMAL(10, 2),
    deposit DECIMAL(10, 2),
    rating DECIMAL(3, 2),
    reviews INT,
    mode VARCHAR(50),
    available BOOLEAN,
    featured BOOLEAN,
    bestSelling BOOLEAN,
    isNew BOOLEAN,
    sellerId VARCHAR(50),
    sellerName VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS categories (
    slug VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    dob DATE,
    role VARCHAR(50) DEFAULT 'customer',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
);


CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customerId INT NOT NULL,
    productId VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL COMMENT 'buy or rent',
    days INT DEFAULT NULL,
    total DECIMAL(10, 2) NOT NULL,
    payment VARCHAR(20) NOT NULL COMMENT 'cod or online',
    status VARCHAR(20) DEFAULT 'pending',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
);

INSERT IGNORE INTO categories (slug, name) VALUES 
('audio', 'Audio'),
('cameras', 'Cameras'),
('drones', 'Drones'),
('wearables', 'Wearables'),
('computers', 'Computers'),
('gaming', 'Gaming'),
('vr', 'VR & AR');

INSERT IGNORE INTO products (id, name, tagline, description, category, brand, image, gallery, price, rentPerDay, deposit, rating, reviews, mode, available, featured, bestSelling, isNew, sellerId, sellerName) VALUES 
('p-001', 'Aurora Pro Wireless Headphones', 'Studio-grade ANC, 40h battery', 'Reference-tuned drivers with adaptive noise cancellation. Spatial audio, multipoint Bluetooth, and a feather-light frame for all-day sessions.', 'audio', 'Aurora', '/src/assets/p-headphones.jpg', '["/src/assets/p-headphones.jpg", "/src/assets/p-headphones.jpg"]', 349, 9, 80, 4.8, 1248, 'both', true, true, true, false, 's-001', 'Aurora Audio Co.'),
('p-002', 'Lumen X1 Mirrorless Camera', '26MP full-frame, 8K video', 'Professional hybrid shooter built for travel and storytelling. In-body stabilization, weather sealing, and a stunning EVF.', 'cameras', 'Lumen', '/src/assets/p-camera.jpg', '["/src/assets/p-camera.jpg"]', 1899, 49, 400, 4.9, 412, 'both', true, true, false, true, 's-002', 'Lumen Imaging'),
('p-003', 'SkyHawk Mini Drone', '4K cinematic, 34min flight', 'Compact, foldable drone with obstacle sensing and a 3-axis gimbal. Smart routes for cinematic capture in seconds.', 'drones', 'SkyHawk', '/src/assets/p-drone.jpg', '["/src/assets/p-drone.jpg"]', 749, 29, 200, 4.6, 286, 'both', true, false, true, false, 's-003', 'SkyHawk Aerials'),
('p-004', 'Pulse Watch Series 5', 'Health, fitness, focus', 'Always-on retina display, ECG, blood-oxygen sensing, and 36h battery. Woven sport bands.', 'wearables', 'Pulse', '/src/assets/p-watch.jpg', '["/src/assets/p-watch.jpg"]', 299, 6, 60, 4.5, 980, 'buy', true, false, false, true, 's-004', 'Pulse Wear'),
('p-005', 'Stratus Air 14', 'Silent. Cool. Powerful.', '14-inch ultraportable with the new M-class chip. Fanless design, 22h battery, and a stunning XDR display.', 'computers', 'Stratus', '/src/assets/p-laptop.jpg', '["/src/assets/p-laptop.jpg"]', 1499, 39, 350, 4.7, 524, 'both', true, true, false, false, 's-005', 'Stratus Computing'),
('p-006', 'Boom Mini Bluetooth Speaker', 'Big sound, tiny package', '360° sound with deep bass and 24h playback. Waterproof and ready to pair stereo with a friend.', 'audio', 'Boom', '/src/assets/p-speaker.jpg', '["/src/assets/p-speaker.jpg"]', 129, 4, 30, 4.4, 1502, 'buy', true, false, true, false, 's-001', 'Aurora Audio Co.'),
('p-007', 'Mira VR Headset', 'Cinematic immersive worlds', 'Pancake lenses, 4K per eye, and full-room tracking. Comfortable for long sessions with adjustable IPD.', 'vr', 'Mira', '/src/assets/p-vr.jpg', '["/src/assets/p-vr.jpg"]', 599, 19, 150, 4.6, 211, 'rent', true, false, false, true, 's-006', 'Mira Reality'),
('p-008', 'ArcadePro Console', 'Next-gen gaming for everyone', '4K HDR gaming, ultra-fast SSD, and a controller redesigned around you. Pre-loaded with three blockbuster titles.', 'gaming', 'Arcade', '/src/assets/p-console.jpg', '["/src/assets/p-console.jpg"]', 499, 14, 120, 4.7, 845, 'both', true, true, true, false, 's-007', 'Arcade Studios');
