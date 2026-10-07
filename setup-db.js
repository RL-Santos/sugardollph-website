const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("shop.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer', 'admin', 'warehouse'))
  )
`);

const add = db.prepare(
  "INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)"
);

add.run("customer1",  bcrypt.hashSync("cust123", 10),  "customer");
add.run("admin1",     bcrypt.hashSync("admin123", 10), "admin");
add.run("warehouse1", bcrypt.hashSync("ware123", 10),  "warehouse");

console.log(db.prepare("SELECT id, username, role FROM users").all());