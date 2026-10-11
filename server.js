const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const multer = require("multer");
const crypto = require("crypto");

const IMAGE_DIR = path.join(__dirname, "public", "images");
fs.mkdirSync(IMAGE_DIR, { recursive: true });

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: IMAGE_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString("hex") + EXT[file.mimetype])
  }),
  fileFilter: (req, file, cb) => cb(null, file.mimetype in EXT),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 }
});

const ROLES = ["customer", "admin", "warehouse"];

const db = new Database("shop.db");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-only-secret",
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Admin page: the server fills in the users table, so the HTML needs no JS
app.get("/admin", requirePageRole("admin"), (req, res) => {
  const users = db.prepare("SELECT id, username, role FROM users").all();

  const rows = users.map(u => {
    let action;
    if (u.username === req.session.user.username) {
      action = "(you)";
    } else {
      const options = ROLES.map(r =>
        `<option value="${r}"${r === u.role ? " selected" : ""}>${r}</option>`).join("");
      action = `<form method="POST" action="/admin/users/${u.id}/role">
        <select name="role">${options}</select> <button type="submit">Save</button>
      </form>`;
    }
    return `<tr><td>${u.id}</td><td>${escapeHtml(u.username)}</td><td>${u.role}</td><td>${action}</td></tr>`;
  }).join("");

  const flash = req.session.flash;
  delete req.session.flash;
  const toast = flash
    ? `<div class="toast ${flash.type}">${escapeHtml(flash.text)}</div>`
    : "";
  
  const productOptions = db.prepare("SELECT id, name FROM products ORDER BY name").all()
    .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");

  const page = fs.readFileSync(path.join(__dirname, "private", "admin.html"), "utf8")
    .replace("<!--TOAST-->", () => toast)
    .replace("<!--USERS-->", () => rows)
    .replace("<!--PRODUCTS-->", () => productOptions);
  res.send(page);
});

// Upload one or more pictures for a product (admin only; role is checked before any file is saved)
app.post("/admin/products/images", requirePageRole("admin"), (req, res) => {
  upload.array("images", 10)(req, res, err => {
    const files = req.files || [];
    const product = db.prepare("SELECT id, name FROM products WHERE id = ?")
      .get(Number(req.body && req.body.product));

    if (err) {
      req.session.flash = { text: "Upload failed: each picture must be 5 MB or less, max 10 at a time.", type: "error" };
    } else if (!product) {
      files.forEach(f => fs.unlink(f.path, () => {}));
      req.session.flash = { text: "Product not found.", type: "error" };
    } else if (files.length === 0) {
      req.session.flash = { text: "No valid pictures chosen (JPG, PNG or WEBP only).", type: "error" };
    } else {
      const add = db.prepare("INSERT INTO product_images (product_id, path) VALUES (?, ?)");
      files.forEach(f => add.run(product.id, "/images/" + f.filename));
      req.session.flash = { text: files.length + " picture(s) added to " + product.name + ".", type: "success" };
    }
    res.redirect("/admin");
  });
});

// Change another account's role (admin only)
app.post("/admin/users/:id/role", requirePageRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body.role || "");
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(id);

  if (!ROLES.includes(role)) req.session.flash = { text: "Unknown role.", type: "error" };
  else if (!target) req.session.flash = { text: "User not found.", type: "error" };
  else if (target.username === req.session.user.username) req.session.flash = { text: "You can't change your own role.", type: "error" };
  else {
    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    req.session.flash = { text: target.username + " is now " + role + ".", type: "success" };
  }
  res.redirect("/admin");
});

app.get("/warehouse", requirePageRole("warehouse"), (req, res) => {
  res.sendFile(path.join(__dirname, "private", "warehouse.html"));
});

// Search products by name and/or category. Empty values return everything.
const CATEGORIES = ["jeans", "trousers", "tops", "others"];

function slugify(name) {
  return name.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

app.get("/api/products", (req, res) => {
  const q = String(req.query.search || "").trim();
  const category = String(req.query.category || "");
  if (category && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Unknown category" });
  }
  const rows = db.prepare(
    `SELECT id, name, description, price, amount, category,
       (SELECT path FROM product_images WHERE product_id = products.id ORDER BY id LIMIT 1) AS image
     FROM products
     WHERE name LIKE ? AND (? = '' OR category = ?)
     ORDER BY name`
  ).all("%" + q + "%", category, category);
  res.json(rows.map(r => ({ ...r, slug: slugify(r.name) })));
});

// One product with all its pictures, found by its link name
app.get("/api/products/:slug", (req, res) => {
  const slug = req.params.slug.toLowerCase();
  const p = db.prepare(
    "SELECT id, name, description, price, amount, category FROM products ORDER BY name"
  ).all().find(r => slugify(r.name) === slug);
  if (!p) return res.status(404).json({ error: "Product not found" });
  p.slug = slugify(p.name);
  p.images = db.prepare("SELECT path FROM product_images WHERE product_id = ? ORDER BY id")
    .all(p.id).map(r => r.path);
  res.json(p);
});

function cartUserId(req) {
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(req.session.user.username);
  return row && row.id;
}

// Reads the cart. Items that went out of stock are dropped, and quantities above the stock are lowered.
function readCart(uid) {
  db.prepare(
    "DELETE FROM cart_items WHERE user_id = ? AND product_id IN (SELECT id FROM products WHERE amount <= 0)"
  ).run(uid);
  db.prepare(
    `UPDATE cart_items
     SET qty = (SELECT amount FROM products WHERE products.id = cart_items.product_id)
     WHERE user_id = ?
       AND qty > (SELECT amount FROM products WHERE products.id = cart_items.product_id)`
  ).run(uid);
  return db.prepare(
    `SELECT p.id, p.name, p.price, p.amount AS max, c.qty,
       (SELECT path FROM product_images WHERE product_id = p.id ORDER BY id LIMIT 1) AS image
     FROM cart_items c JOIN products p ON p.id = c.product_id
     WHERE c.user_id = ?
     ORDER BY p.name`
  ).all(uid);
}

app.get("/api/cart", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const uid = cartUserId(req);
  if (!uid) return res.status(401).json({ error: "Not logged in" });
  res.json(readCart(uid));
});

// Set the quantity of one product in the cart (0 or less removes it)
app.put("/api/cart/:productId", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const uid = cartUserId(req);
  if (!uid) return res.status(401).json({ error: "Not logged in" });

  const productId = Number(req.params.productId);
  const qty = Number(req.body.qty);
  if (!Number.isInteger(qty)) return res.status(400).json({ error: "Invalid quantity" });

  const product = db.prepare("SELECT id, amount FROM products WHERE id = ?").get(productId);
  if (!product) return res.status(404).json({ error: "Product not found" });

  if (qty <= 0) {
    db.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?").run(uid, productId);
  } else {
    if (product.amount <= 0) return res.status(400).json({ error: "Out of stock" });
    db.prepare(
      `INSERT INTO cart_items (user_id, product_id, qty) VALUES (?, ?, ?)
       ON CONFLICT(user_id, product_id) DO UPDATE SET qty = excluded.qty`
    ).run(uid, productId, Math.min(qty, product.amount));
  }
  res.json(readCart(uid));
});

app.delete("/api/cart/:productId", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const uid = cartUserId(req);
  if (!uid) return res.status(401).json({ error: "Not logged in" });
  db.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?")
    .run(uid, Number(req.params.productId));
  res.json(readCart(uid));
});

app.get(["/search", "/product/:slug", "/login", "/register"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running at http://localhost:" + PORT));