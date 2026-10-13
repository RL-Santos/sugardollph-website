const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("shop.db");

// ---------- TABLES ----------

// Orders now allow the 'in_progress' status. Recreate the (still empty) orders tables once.
const oldOrders = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'orders'").get();
if (oldOrders && !oldOrders.sql.includes("in_progress")) {
  if (db.prepare("SELECT COUNT(*) AS n FROM orders").get().n > 0) {
    throw new Error("orders table has data; migrate it manually");
  }
  db.exec("DROP TABLE order_items; DROP TABLE orders;");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'admin', 'warehouse'))
  );

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

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','paid','packed','shipped','delivered','cancelled','returned')),
    total REAL NOT NULL,
    payment_method TEXT,
    ship_name TEXT,
    ship_phone TEXT,
    ship_address TEXT,
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
`);

if (!db.prepare("PRAGMA table_info(users)").all().some(c => c.name === "active")) {
  db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
}

// ---------- USERS ----------

const addUser = db.prepare(
  "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)"
);

addUser.run("customer1",  bcrypt.hashSync("cust123", 10),  "customer");
addUser.run("admin1",     bcrypt.hashSync("admin123", 10), "admin");
addUser.run("warehouse1", bcrypt.hashSync("ware123", 10),  "warehouse");

// ---------- PRODUCTS ----------

const addProduct = db.prepare(
  "INSERT OR IGNORE INTO products (name, description, price, amount, category) VALUES (?, ?, ?, ?, ?)"
);

addProduct.run("Sugardoll Baby Tee", "Baby Tee Short-sleeve Crop top", 180, 100, "tops");
addProduct.run("Zara Slouchy Jeans", "Trendy jeans", 450, 100, "jeans");
addProduct.run("Sugardoll Lottie Pants", "Unique and Trendy pants", 229, 100, "trousers");