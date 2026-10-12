const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("shop.db");

// ---------- TABLES ----------
db.exec("DROP TABLE IF EXISTS customer_profiles");

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
  phone TEXT NOT NULL,
  street TEXT NOT NULL,
  barangay TEXT NOT NULL,
  city TEXT NOT NULL,
  province TEXT NOT NULL,
  postal_code TEXT,
  notes TEXT
  );
`);

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