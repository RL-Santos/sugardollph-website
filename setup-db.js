const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("shop.db");

db.exec(`
  -- ---------- accounts ----------
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'admin', 'warehouse')),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS customer_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    middle_initial TEXT,
    last_name TEXT NOT NULL,
    name_extension TEXT,
    email TEXT NOT NULL,
    phone TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    recipient_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    street TEXT NOT NULL,
    barangay TEXT NOT NULL,
    city TEXT NOT NULL,
    province TEXT NOT NULL,
    postal_code TEXT,
    notes TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('GCASH', 'MAYA', 'CARD')),
    holder_name TEXT NOT NULL,
    number TEXT NOT NULL,            -- mobile number, or only the last 4 digits for cards
    expiry TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
  );

  -- ---------- products + cart ----------
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL CHECK (category IN ('jeans', 'trousers', 'tops', 'others'))
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    path TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    qty INTEGER NOT NULL CHECK (qty > 0),
    PRIMARY KEY (user_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS discount_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
    value REAL NOT NULL CHECK (value > 0),
    min_spend REAL NOT NULL DEFAULT 0,
    max_uses INTEGER,                -- empty = unlimited
    used INTEGER NOT NULL DEFAULT 0,
    expires_on TEXT,                 -- YYYY-MM-DD, empty = no expiry
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- ---------- orders ----------
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','in_progress','paid','packed','shipped','delivered','cancelled','returned')),
    subtotal REAL,
    discount_code TEXT,
    discount_amount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    payment_method TEXT,
    payment_detail TEXT,
    payment_proof TEXT,              -- file name of the proof picture uploaded with a return
    ship_name TEXT,
    ship_phone TEXT,
    ship_address TEXT,
    scan_token TEXT UNIQUE,          -- random value inside the QR label
    cancel_status TEXT,              -- pending / approved / rejected
    cancel_requested_at TEXT,
    cancel_reason TEXT,
    return_status TEXT,              -- pending / approved / rejected
    return_requested_at TEXT,
    return_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    qty INTEGER NOT NULL
  );

  -- ---------- customer service chat ----------
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    sender TEXT NOT NULL CHECK (sender IN ('customer', 'admin', 'system')),
    sender_id INTEGER,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- ---------- notifications, logs, app state ----------
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('order', 'stock', 'user', 'product')),
    order_id INTEGER,
    to_status TEXT,
    method TEXT,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- ---------- indexes ----------
  CREATE INDEX IF NOT EXISTS idx_activity_order ON activity_log(order_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, id);
`);

// ---------- default accounts ----------
const addUser = db.prepare("INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)");
addUser.run("customer1",  bcrypt.hashSync("cust123", 10),  "customer");
addUser.run("admin1",     bcrypt.hashSync("admin123", 10), "admin");
addUser.run("warehouse1", bcrypt.hashSync("ware123", 10),  "warehouse");

// ---------- default products ----------
const addProduct = db.prepare(
  "INSERT OR IGNORE INTO products (name, description, price, amount, category) VALUES (?, ?, ?, ?, ?)"
);
addProduct.run("Sugardoll Baby Tee", "Baby Tee Short-sleeve Crop top", 180, 100, "tops");
addProduct.run("Zara Slouchy Jeans", "Trendy jeans", 450, 100, "jeans");
addProduct.run("Sugardoll Lottie Pants", "Unique and Trendy pants", 229, 100, "trousers");

console.log("Database is ready.");