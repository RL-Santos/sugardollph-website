const Database = require("better-sqlite3");

const db = new Database("products.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL CHECK (category IN ('jeans', 'trousers', 'tops', 'others'))
  )
`);

const add = db.prepare(
  "INSERT OR IGNORE INTO products (name, description, price, amount, category) VALUES (?, ?, ?, ?, ?)"
);

add.run("Sugardoll Baby Tee", "Baby Tee Short-sleeve Crop top", 180, 100, "tops");
add.run("Zara Slouchy Jeans", "Trendy jeans", 450, 100, "jeans");
add.run("Sugardoll Lottie Pants", "Unique and Trendy pants", 229, 100, "trousers");

console.log(db.prepare("SELECT id, name, category, price, amount FROM products").all());