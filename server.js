const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database("shop.db");
const app = express();

app.use(express.json());
app.use(session({
  secret: "change-this-to-a-long-random-string",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));
app.use(express.static("public"));

// Log in: check the password against the database
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  req.session.user = { username: user.username, role: user.role };
  res.json(req.session.user);
});

// Password rules for new accounts. Returns an error message, or null if the password is fine.
function checkPassword(password) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (Buffer.byteLength(password) > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Z]/.test(password)) return "Password needs at least 1 uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs at least 1 lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs at least 1 number.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Password needs at least 1 symbol (like ! @ # $).";
  return null;
}

// Create a customer account. The role is always "customer", whatever the browser sends.
app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-30 letters, numbers or underscores." });
  }
  const passwordError = checkPassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  // Block "Admin1" when "admin1" already exists
  const taken = db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)").get(username);
  if (taken) return res.status(409).json({ error: "That username is taken." });

  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'customer')")
    .run(username, bcrypt.hashSync(password, 10));

  req.session.user = { username, role: "customer" };
  res.json(req.session.user);
});

// Log out
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Who is logged in right now?
app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  res.json(req.session.user);
});

// Blocks anyone who doesn't have the right role
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
    if (req.session.user.role !== role) return res.status(403).json({ error: "Not allowed" });
    next();
  };
}

// Example admin-only route: customers get a 403 even if they type the URL
app.get("/api/admin/users", requireRole("admin"), (req, res) => {
  res.json(db.prepare("SELECT id, username, role FROM users").all());
});

// Page version of the role check: sends people away instead of returning JSON
function requirePageRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect("/");
    if (req.session.user.role !== role) {
      return res.status(403).send("Not allowed. <a href='/'>Back to shop</a>");
    }
    next();
  };
}

app.get("/admin", requirePageRole("admin"), (req, res) => {
  res.sendFile(path.join(__dirname, "private", "admin.html"));
});

app.get("/warehouse", requirePageRole("warehouse"), (req, res) => {
  res.sendFile(path.join(__dirname, "private", "warehouse.html"));
});

// Search products by name and/or category. Empty values return everything.
const CATEGORIES = ["jeans", "trousers", "tops", "others"];

app.get("/api/products", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const q = String(req.query.search || "").trim();
  const category = String(req.query.category || "");
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Unknown category" });
  }
  const rows = db.prepare(
    `SELECT id, name, description, price, amount, category
     FROM products
     WHERE name LIKE ? AND (? = '' OR category = ?)
     ORDER BY name`
  ).all("%" + q + "%", category, category);
  res.json(rows);
});

app.listen(3000, () => console.log("Running at http://localhost:3000"));