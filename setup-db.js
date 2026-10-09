const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("shop.db"); // creates the file if it doesn't exist

// ---------- TABLES ----------

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

// ---------- CHECK ----------

console.log("Users:", db.prepare("SELECT id, username, role FROM users").all());
console.log("Products:", db.prepare("SELECT id, name, category, price, amount FROM products").all());