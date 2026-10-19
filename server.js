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

// Keeps the session in step with the database: deactivated users are logged out, role changes apply right away
app.use((req, res, next) => {
  const s = req.session.user;
  if (s) {
    const u = db.prepare("SELECT role, active FROM users WHERE username = ?").get(s.username);
    if (!u || !u.active) delete req.session.user;
    else s.role = u.role;
  }
  next();
});

// Log in: check the password against the database
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }
  if (!user.active) return res.status(403).json({ error: "This account has been deactivated." });
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
// Normalizes 09XXXXXXXXX or +639XXXXXXXXX to 09XXXXXXXXX. Returns null if it doesn't look right.
function cleanPhone(p) {
  const s = String(p || "").replace(/[\s-]/g, "");
  const m = s.match(/^(?:\+63|0)(9\d{9})$/);
  return m ? "0" + m[1] : null;
}

const MAX_ADDRESSES = 10;

function fullName(p) {
  return [p.first_name, p.middle_initial ? p.middle_initial + "." : "", p.last_name, p.name_extension]
    .filter(Boolean).join(" ");
}

// Checks an address from the browser. Returns { a } if fine, or { error }.
function readAddress(b) {
  const text = k => String(b[k] || "").trim();
  const a = {
    label: text("label").slice(0, 30),
    recipient_name: text("recipient_name"),
    phone: cleanPhone(b.phone),
    street: text("street"), barangay: text("barangay"), city: text("city"),
    province: text("province"), postal_code: text("postal_code"), notes: text("notes")
  };
  if (!a.recipient_name || !a.street || !a.barangay || !a.city || !a.province) {
    return { error: "Please fill in the recipient name and the complete address." };
  }
  if (!a.phone) return { error: "Enter a valid mobile number (09XXXXXXXXX)." };
  return { a };
}

function insertAddress(uid, a, isDefault) {
  db.prepare(
    `INSERT INTO addresses
     (user_id, label, recipient_name, phone, street, barangay, city, province, postal_code, notes, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid, a.label, a.recipient_name, a.phone, a.street, a.barangay, a.city,
        a.province, a.postal_code, a.notes, isDefault);
}

app.post("/api/register", (req, res) => {
  const b = req.body;
  const username = String(b.username || "").trim();
  const password = String(b.password || "");
  const text = k => String(b[k] || "").trim();

  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-30 letters, numbers or underscores." });
  }
  const passwordError = checkPassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const profile = {
    first_name: text("first_name"),
    middle_initial: text("middle_initial").replace(/\./g, "").toUpperCase(),
    last_name: text("last_name"),
    name_extension: text("name_extension"),
    email: text("email"),
    phone: cleanPhone(b.phone)
  };
  if (!profile.first_name || !profile.last_name) {
    return res.status(400).json({ error: "Please fill in your first and last name." });
  }
  if (!/^[A-Za-z]?$/.test(profile.middle_initial)) {
    return res.status(400).json({ error: "Middle initial must be a single letter." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (!profile.phone) {
    return res.status(400).json({ error: "Enter a valid mobile number (09XXXXXXXXX)." });
  }
  const addr = readAddress({ ...b, label: "Home", recipient_name: fullName(profile) });
  if (addr.error) return res.status(400).json({ error: "Please fill in your complete address." });

  const taken = db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?)").get(username);
  if (taken) return res.status(409).json({ error: "That username is taken." });

  db.transaction(() => {
    const info = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'customer')")
      .run(username, bcrypt.hashSync(password, 10));
    db.prepare(
      `INSERT INTO customer_profiles
       (user_id, first_name, middle_initial, last_name, name_extension, email, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(info.lastInsertRowid, profile.first_name, profile.middle_initial, profile.last_name,
          profile.name_extension, profile.email, profile.phone);
    insertAddress(info.lastInsertRowid, addr.a, 1);
  })();

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

// ---------- ADMIN ----------
const admin = requireRole("admin");
const ACTIVE_ORDER = ["pending", "in_progress", "paid", "packed", "shipped"];
const REVENUE_ORDER = ["in_progress", "paid", "packed", "shipped", "delivered"];

app.get(["/admin", "/admin/users", "/admin/users/:id", "/admin/products", "/admin/orders", "/admin/orders/:id",
         "/admin/chats", "/admin/chats/:id"],
  requirePageRole("admin"),
  (req, res) => res.sendFile(path.join(__dirname, "private", "admin.html")));

// Orders with their items. `where` is a SQL fragment that may use the aliases o (orders) and u (users).
function loadOrders(where, ...params) {
  const items = db.prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?");
  return db.prepare(
    `SELECT o.*, u.username FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where} ORDER BY o.id DESC`
  ).all(...params).map(o => ({ ...o, items: items.all(o.id) }));
}

app.get("/api/admin/overview", admin, (req, res) => {
  const counts = {};
  db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all()
    .forEach(r => { counts[r.status] = r.n; });
  const marks = REVENUE_ORDER.map(() => "?").join(",");
  res.json({
    counts,
    revenue: db.prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM orders WHERE status IN (${marks})`)
      .get(...REVENUE_ORDER).t,
    customers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    products: db.prepare("SELECT COUNT(*) AS n FROM products").get().n,
    trending: db.prepare(
      `SELECT oi.name, SUM(oi.qty) AS sold FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status NOT IN ('cancelled','returned') GROUP BY oi.name ORDER BY sold DESC LIMIT 5`).all(),
    lowStock: db.prepare("SELECT name, amount FROM products WHERE amount <= 5 ORDER BY amount, name LIMIT 8").all(),
    recent: db.prepare(
      `SELECT o.id, o.status, o.total, COALESCE(u.username, o.ship_name, 'Deleted account') AS customer
       FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 5`).all()
  });
});

// ----- users -----
app.get("/api/admin/users", admin, (req, res) => {
  const q = "%" + String(req.query.search || "").trim() + "%";
  res.json(db.prepare(
    `SELECT u.id, u.username, u.role, u.active, p.first_name, p.last_name, p.email,
       (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS orders
     FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id
     WHERE u.username LIKE ?
        OR COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '') LIKE ?
        OR COALESCE(p.email, '') LIKE ?
     ORDER BY u.username`
  ).all(q, q, q));
});

app.get("/api/admin/users/:id", admin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT id, username, role, active FROM users WHERE id = ?").get(id);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.profile = db.prepare("SELECT * FROM customer_profiles WHERE user_id = ?").get(id) || null;
  user.addresses = db.prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id").all(id);
  user.orders = loadOrders("WHERE o.user_id = ?", id);
  res.json(user);
});

app.put("/api/admin/users/:id/role", admin, (req, res) => {
  const id = Number(req.params.id);
  const role = String(req.body.role || "");
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(id);
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Unknown role." });
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.username === req.session.user.username) {
    return res.status(400).json({ error: "You can't change your own role." });
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  res.json({ ok: true });
});

app.put("/api/admin/users/:id/active", admin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare("SELECT id, username FROM users WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.username === req.session.user.username) {
    return res.status(400).json({ error: "You can't deactivate your own account." });
  }
  db.prepare("UPDATE users SET active = ? WHERE id = ?").run(req.body.active ? 1 : 0, id);
  res.json({ ok: true });
});

// ----- products (the list itself comes from the public GET /api/products) -----
const num = v => String(v ?? "").trim() === "" ? NaN : Number(v);

function checkProduct(b, selfId) {
  const p = {
    name: String(b.name || "").trim(), description: String(b.description || "").trim(),
    price: num(b.price), amount: num(b.amount), category: String(b.category || "")
  };
  if (!p.name || !slugify(p.name)) return { error: "Enter a product name." };
  if (!Number.isFinite(p.price) || p.price < 0) return { error: "Enter a valid price." };
  if (!Number.isInteger(p.amount) || p.amount < 0) return { error: "Stock must be a whole number, 0 or more." };
  if (!CATEGORIES.includes(p.category)) return { error: "Pick a category." };
  const clash = db.prepare("SELECT id, name FROM products").all()
    .some(r => r.id !== selfId && slugify(r.name) === slugify(p.name));
  if (clash) return { error: "A product with this name already exists." };
  return { p };
}

app.get("/api/admin/products/:id", admin, (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: "Product not found." });
  p.images = db.prepare("SELECT id, path FROM product_images WHERE product_id = ? ORDER BY id").all(p.id);
  res.json(p);
});

app.post("/api/admin/products", admin, (req, res) => {
  const r = checkProduct(req.body, 0);
  if (r.error) return res.status(400).json({ error: r.error });
  const info = db.prepare(
    "INSERT INTO products (name, description, price, amount, category) VALUES (?, ?, ?, ?, ?)"
  ).run(r.p.name, r.p.description, r.p.price, r.p.amount, r.p.category);
  res.json({ id: Number(info.lastInsertRowid) });
});

app.put("/api/admin/products/:id", admin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Product not found." });
  }
  const r = checkProduct(req.body, id);
  if (r.error) return res.status(400).json({ error: r.error });
  db.prepare("UPDATE products SET name = ?, description = ?, price = ?, amount = ?, category = ? WHERE id = ?")
    .run(r.p.name, r.p.description, r.p.price, r.p.amount, r.p.category, id);
  res.json({ id });
});

app.delete("/api/admin/products/:id", admin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Product not found." });
  }
  const pics = db.prepare("SELECT path FROM product_images WHERE product_id = ?").all(id);
  db.prepare("DELETE FROM products WHERE id = ?").run(id); // pictures and cart rows cascade; old orders keep the name
  pics.forEach(i => fs.unlink(path.join(__dirname, "public", i.path), () => {}));
  res.json({ ok: true });
});

app.post("/api/admin/products/:id/images", admin, (req, res) => {
  upload.array("images", 10)(req, res, err => {
    const files = req.files || [];
    const drop = () => files.forEach(f => fs.unlink(f.path, () => {}));
    const product = db.prepare("SELECT id FROM products WHERE id = ?").get(Number(req.params.id));
    if (err) { drop(); return res.status(400).json({ error: "Each picture must be 5 MB or less, max 10 at a time." }); }
    if (!product) { drop(); return res.status(404).json({ error: "Product not found." }); }
    if (files.length === 0) return res.status(400).json({ error: "No valid pictures chosen (JPG, PNG or WEBP only)." });
    const add = db.prepare("INSERT INTO product_images (product_id, path) VALUES (?, ?)");
    files.forEach(f => add.run(product.id, "/images/" + f.filename));
    res.json({ added: files.length });
  });
});

app.delete("/api/admin/products/:id/images/:imageId", admin, (req, res) => {
  const img = db.prepare("SELECT id, path FROM product_images WHERE id = ? AND product_id = ?")
    .get(Number(req.params.imageId), Number(req.params.id));
  if (!img) return res.status(404).json({ error: "Picture not found." });
  db.prepare("DELETE FROM product_images WHERE id = ?").run(img.id);
  fs.unlink(path.join(__dirname, "public", img.path), () => {});
  res.json({ ok: true });
});

// ----- orders -----
app.get("/api/admin/orders", admin, (req, res) => {
  const q = "%" + String(req.query.search || "").trim().replace(/^#/, "") + "%";
  const status = String(req.query.status || "");
  res.json(loadOrders(
    `WHERE (? = '' OR o.status = ?)
       AND (CAST(o.id AS TEXT) LIKE ? OR COALESCE(u.username, '') LIKE ? OR COALESCE(o.ship_name, '') LIKE ?)`,
    status, status, q, q, q));
});

app.get("/api/admin/orders/:id", admin, (req, res) => {
  const o = loadOrders("WHERE o.id = ?", Number(req.params.id))[0];
  if (!o) return res.status(404).json({ error: "Order not found." });
  res.json(o);
});

app.put("/api/admin/orders/:id/approve", admin, (req, res) => {
  const o = db.prepare("SELECT id, status FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Order not found." });
  if (o.status !== "pending") return res.status(400).json({ error: "Only pending orders can be approved." });
  db.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").run(o.id);
  res.json({ ok: true });
});

app.put("/api/admin/orders/:id/cancel", admin, (req, res) => {
  const o = db.prepare("SELECT id, status FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: "Order not found." });
  if (!ACTIVE_ORDER.includes(o.status)) return res.status(400).json({ error: "This order can't be cancelled." });
  db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(o.id);
    const restock = db.prepare("UPDATE products SET amount = amount + ? WHERE id = ?");
    db.prepare("SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL")
      .all(o.id).forEach(i => restock.run(i.qty, i.product_id));
  })();
  res.json({ ok: true });
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

// Logged-in check that also finds the user's id (req.uid)
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(req.session.user.username);
  if (!row) return res.status(401).json({ error: "Not logged in" });
  req.uid = row.id;
  next();
}

// Makes sure the account has a profile row
function ensureProfile(uid) {
  db.prepare(
    `INSERT OR IGNORE INTO customer_profiles (user_id, first_name, last_name, email, phone)
     VALUES (?, '', '', '', '')`
  ).run(uid);
}

app.get("/api/profile", requireLogin, (req, res) => {
  ensureProfile(req.uid);
  const p = db.prepare("SELECT * FROM customer_profiles WHERE user_id = ?").get(req.uid);
  res.json({ ...p, username: req.session.user.username });
});

app.put("/api/profile", requireLogin, (req, res) => {
  const b = req.body;
  const text = k => String(b[k] || "").trim();
  const username = text("username");
  const p = {
    first_name: text("first_name"),
    middle_initial: text("middle_initial").replace(/\./g, "").toUpperCase(),
    last_name: text("last_name"),
    name_extension: text("name_extension"),
    email: text("email"),
    phone: cleanPhone(b.phone)
  };

  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: "Username must be 3-30 letters, numbers or underscores." });
  }
  if (!p.first_name || !p.last_name) return res.status(400).json({ error: "First and last name are required." });
  if (!/^[A-Za-z]?$/.test(p.middle_initial)) return res.status(400).json({ error: "Middle initial must be a single letter." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!p.phone) return res.status(400).json({ error: "Enter a valid mobile number (09XXXXXXXXX)." });

  const taken = db.prepare("SELECT 1 FROM users WHERE lower(username) = lower(?) AND id != ?").get(username, req.uid);
  if (taken) return res.status(409).json({ error: "That username is taken." });

  db.transaction(() => {
    ensureProfile(req.uid);
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, req.uid);
    db.prepare(
      `UPDATE customer_profiles
       SET first_name = ?, middle_initial = ?, last_name = ?, name_extension = ?, email = ?, phone = ?
       WHERE user_id = ?`
    ).run(p.first_name, p.middle_initial, p.last_name, p.name_extension, p.email, p.phone, req.uid);
  })();

  req.session.user.username = username;
  res.json(req.session.user);
});

app.put("/api/password", requireLogin, (req, res) => {
  const current = String(req.body.current_password || "");
  const next = String(req.body.new_password || "");
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.uid);

  if (!bcrypt.compareSync(current, user.password_hash)) {
    return res.status(400).json({ error: "Current password is wrong." });
  }
  const problem = checkPassword(next);
  if (problem) return res.status(400).json({ error: problem });
  if (next === current) return res.status(400).json({ error: "New password must be different." });

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(next, 10), req.uid);
  res.json({ ok: true });
});

app.delete("/api/account", requireLogin, (req, res) => {
  if (req.session.user.role !== "customer") {
    return res.status(403).json({ error: "Only customer accounts can be deleted here." });
  }
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.uid);
  if (!bcrypt.compareSync(String(req.body.password || ""), user.password_hash)) {
    return res.status(400).json({ error: "Wrong password." });
  }
  const active = db.prepare(
    "SELECT 1 FROM orders WHERE user_id = ? AND status IN ('pending','in_progress','paid','packed','shipped')"
  ).get(req.uid);
  if (active) return res.status(400).json({ error: "You still have an order in progress." });

  db.transaction(() => {
    db.prepare("UPDATE orders SET user_id = NULL WHERE user_id = ?").run(req.uid);
    db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.uid);
    db.prepare("DELETE FROM addresses WHERE user_id = ?").run(req.uid);
    db.prepare("DELETE FROM customer_profiles WHERE user_id = ?").run(req.uid);
    db.prepare("DELETE FROM users WHERE id = ?").run(req.uid);
  })();
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/orders", requireLogin, (req, res) => {
  const orders = db.prepare(
    "SELECT id, status, total, payment_method, created_at FROM orders WHERE user_id = ? ORDER BY id DESC"
  ).all(req.uid);
  const items = db.prepare("SELECT name, price, qty FROM order_items WHERE order_id = ?");
  res.json(orders.map(o => ({ ...o, items: items.all(o.id) })));
});

app.put("/api/orders/:id/cancel", requireLogin, (req, res) => {
  const o = db.prepare("SELECT id FROM orders WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.uid);
  if (!o) return res.status(404).json({ error: "Order not found." });

  const done = db.transaction(() => {
    const info = db.prepare(
      "UPDATE orders SET status = 'cancelled' WHERE id = ? AND status IN ('pending','in_progress')"
    ).run(o.id);
    if (info.changes === 0) return false; // already moved past in_progress, or already cancelled
    const restock = db.prepare("UPDATE products SET amount = amount + ? WHERE id = ?");
    db.prepare("SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL")
      .all(o.id).forEach(i => restock.run(i.qty, i.product_id));
    return true;
  })();

  if (!done) return res.status(400).json({ error: "This order can no longer be cancelled." });
  res.json({ ok: true });
});

app.post("/api/checkout", requireLogin, (req, res) => {
  const cart = readCart(req.uid);
  if (cart.length === 0) return res.status(400).json({ error: "Your cart is empty." });
  const addr = db.prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id LIMIT 1").get(req.uid);
  if (!addr) return res.status(400).json({ error: "Add a delivery address in your account first." });

  const total = cart.reduce((n, i) => n + i.price * i.qty, 0);
  const shipAddress = [addr.street, addr.barangay, addr.city, addr.province, addr.postal_code].filter(Boolean).join(", ");
  try {
    const orderId = db.transaction(() => {
      const info = db.prepare(
        `INSERT INTO orders (user_id, status, total, payment_method, ship_name, ship_phone, ship_address)
         VALUES (?, 'pending', ?, 'COD', ?, ?, ?)`
      ).run(req.uid, total, addr.recipient_name, addr.phone, shipAddress);
      const addItem = db.prepare(
        "INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)");
      const takeStock = db.prepare("UPDATE products SET amount = amount - ? WHERE id = ? AND amount >= ?");
      cart.forEach(i => {
        if (takeStock.run(i.qty, i.id, i.qty).changes === 0) throw new Error("out of stock");
        addItem.run(info.lastInsertRowid, i.id, i.name, i.price, i.qty);
      });
      db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.uid);
      return Number(info.lastInsertRowid);
    })();
    res.json({ orderId });
  } catch {
    res.status(400).json({ error: "Some items just ran out of stock. Please check your cart." });
  }
});

app.get("/api/addresses", requireLogin, (req, res) => {
  res.json(db.prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id").all(req.uid));
});

app.post("/api/addresses", requireLogin, (req, res) => {
  const r = readAddress(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const count = db.prepare("SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?").get(req.uid).n;
  if (count >= MAX_ADDRESSES) {
    return res.status(400).json({ error: "You can save up to " + MAX_ADDRESSES + " addresses." });
  }
  insertAddress(req.uid, r.a, count === 0 ? 1 : 0); // the first address is the default
  res.json({ ok: true });
});

app.put("/api/addresses/:id", requireLogin, (req, res) => {
  const r = readAddress(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const a = r.a;
  const info = db.prepare(
    `UPDATE addresses
     SET label = ?, recipient_name = ?, phone = ?, street = ?, barangay = ?, city = ?,
         province = ?, postal_code = ?, notes = ?
     WHERE id = ? AND user_id = ?`
  ).run(a.label, a.recipient_name, a.phone, a.street, a.barangay, a.city,
        a.province, a.postal_code, a.notes, Number(req.params.id), req.uid);
  if (info.changes === 0) return res.status(404).json({ error: "Address not found." });
  res.json({ ok: true });
});

app.put("/api/addresses/:id/default", requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const found = db.prepare("SELECT 1 FROM addresses WHERE id = ? AND user_id = ?").get(id, req.uid);
  if (!found) return res.status(404).json({ error: "Address not found." });
  db.transaction(() => {
    db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(req.uid);
    db.prepare("UPDATE addresses SET is_default = 1 WHERE id = ?").run(id);
  })();
  res.json({ ok: true });
});

app.delete("/api/addresses/:id", requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT is_default FROM addresses WHERE id = ? AND user_id = ?").get(id, req.uid);
  if (!row) return res.status(404).json({ error: "Address not found." });
  db.transaction(() => {
    db.prepare("DELETE FROM addresses WHERE id = ?").run(id);
    if (row.is_default) {
      // Deleted the default? The oldest remaining address takes over.
      db.prepare(
        `UPDATE addresses SET is_default = 1
         WHERE id = (SELECT MIN(id) FROM addresses WHERE user_id = ?)`
      ).run(req.uid);
    }
  })();
  res.json({ ok: true });
});

// ---------- CUSTOMER SERVICE CHAT ----------
const CHAT_TOPICS = {
  order_status: "Where is my order?",
  cancel_order: "Cancel or change an order",
  return_refund: "Return or refund",
  product: "Product or sizing question",
  account: "Account or login help",
  other: "Something else (not listed)"
};
const MAX_MESSAGE = 1000;

// One chat row with customer name, who claimed it, and its last customer/admin message
const CHAT_SELECT = `
  SELECT c.id, c.user_id, c.topic, c.status, c.admin_id, c.created_at, c.updated_at,
    COALESCE(NULLIF(ap.first_name, ''), au.username) AS agent_name,
    cu.username AS customer_username,
    TRIM(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')) AS customer_name,
    (SELECT body FROM chat_messages WHERE chat_id = c.id AND sender != 'system' ORDER BY id DESC LIMIT 1) AS last_body,
    (SELECT sender FROM chat_messages WHERE chat_id = c.id AND sender != 'system' ORDER BY id DESC LIMIT 1) AS last_sender
  FROM chats c
  JOIN users cu ON cu.id = c.user_id
  LEFT JOIN customer_profiles cp ON cp.user_id = c.user_id
  LEFT JOIN users au ON au.id = c.admin_id
  LEFT JOIN customer_profiles ap ON ap.user_id = c.admin_id`;

const shapeChat = (c, viewerId) => ({ ...c, topic_label: CHAT_TOPICS[c.topic], mine: c.admin_id === viewerId });
const chatText = v => String(v ?? "").trim().slice(0, MAX_MESSAGE);
const adminIdOf = req => db.prepare("SELECT id FROM users WHERE username = ?").get(req.session.user.username).id;

// An admin's first name, or their username if they haven't filled in a profile
function agentName(adminId) {
  const r = db.prepare(
    `SELECT COALESCE(NULLIF(p.first_name, ''), u.username) AS n
     FROM users u LEFT JOIN customer_profiles p ON p.user_id = u.id WHERE u.id = ?`).get(adminId);
  return r ? r.n : "An agent";
}

function addMessage(chatId, sender, senderId, body) {
  db.prepare("INSERT INTO chat_messages (chat_id, sender, sender_id, body) VALUES (?, ?, ?, ?)")
    .run(chatId, sender, senderId, body);
  db.prepare("UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(chatId);
}

// Messages newer than `after`. Admin messages carry the admin's first name.
function chatMessages(chatId, after) {
  return db.prepare(
    `SELECT m.id, m.sender, m.body, m.created_at, COALESCE(NULLIF(p.first_name, ''), u.username) AS name
     FROM chat_messages m
     LEFT JOIN users u ON u.id = m.sender_id AND m.sender = 'admin'
     LEFT JOIN customer_profiles p ON p.user_id = u.id
     WHERE m.chat_id = ? AND m.id > ? ORDER BY m.id`).all(chatId, after);
}

function endChat(id, text) {
  db.transaction(() => {
    db.prepare("UPDATE chats SET status = 'closed' WHERE id = ?").run(id);
    addMessage(id, "system", null, text);
  })();
}

function requireCustomer(req, res, next) {
  requireLogin(req, res, () => {
    if (req.session.user.role !== "customer") return res.status(403).json({ error: "Only customers can use chat." });
    next();
  });
}

// ----- customer side -----
app.get("/api/chat/topics", (req, res) => {
  res.json(Object.entries(CHAT_TOPICS).map(([key, label]) => ({ key, label })));
});

app.get("/api/chats", requireCustomer, (req, res) => {
  res.json(db.prepare(`${CHAT_SELECT} WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id DESC`)
    .all(req.uid).map(c => shapeChat(c)));
});

app.post("/api/chats", requireCustomer, (req, res) => {
  const topic = String(req.body.topic || "");
  const message = chatText(req.body.message);
  if (!Object.hasOwn(CHAT_TOPICS, topic)) return res.status(400).json({ error: "Pick what you need help with." });
  if (topic === "other" && message.length < 10) {
    return res.status(400).json({ error: "Please describe your concern (at least 10 characters)." });
  }
  // One open chat per concern. Reuse it instead of creating a duplicate.
  const open = db.prepare("SELECT id FROM chats WHERE user_id = ? AND topic = ? AND status = 'open'").get(req.uid, topic);
  if (open) {
    if (message) addMessage(open.id, "customer", req.uid, message);
    return res.json({ id: open.id });
  }
  const id = db.transaction(() => {
    const cid = Number(db.prepare("INSERT INTO chats (user_id, topic) VALUES (?, ?)").run(req.uid, topic).lastInsertRowid);
    addMessage(cid, "system", null, "Thanks for reaching out! An agent will join this chat shortly.");
    if (message) addMessage(cid, "customer", req.uid, message);
    return cid;
  })();
  res.json({ id });
});

app.get("/api/chats/:id/messages", requireCustomer, (req, res) => {
  const chat = db.prepare(`${CHAT_SELECT} WHERE c.id = ? AND c.user_id = ?`).get(Number(req.params.id), req.uid);
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  res.json({ chat: shapeChat(chat), messages: chatMessages(chat.id, Number(req.query.after) || 0) });
});

app.post("/api/chats/:id/messages", requireCustomer, (req, res) => {
  const chat = db.prepare("SELECT id, status FROM chats WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.uid);
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.status !== "open") return res.status(400).json({ error: "This chat has ended." });
  const body = chatText(req.body.body);
  if (!body) return res.status(400).json({ error: "Type a message first." });
  addMessage(chat.id, "customer", req.uid, body);
  res.json({ ok: true });
});

app.put("/api/chats/:id/close", requireCustomer, (req, res) => {
  const chat = db.prepare("SELECT id, status FROM chats WHERE id = ? AND user_id = ?").get(Number(req.params.id), req.uid);
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.status === "open") endChat(chat.id, "The customer ended this chat.");
  res.json({ ok: true });
});

// ----- admin side -----
// Business-rule failures use 409 (not 403) because admin.js sends any 403 back to the home page.
app.get("/api/admin/chats", admin, (req, res) => {
  const status = req.query.status === "closed" ? "closed" : "open";
  const me = adminIdOf(req);
  res.json(db.prepare(`${CHAT_SELECT} WHERE c.status = ? ORDER BY c.updated_at DESC, c.id DESC`)
    .all(status).map(c => shapeChat(c, me)));
});

app.get("/api/admin/chats/:id/messages", admin, (req, res) => {
  const chat = db.prepare(`${CHAT_SELECT} WHERE c.id = ?`).get(Number(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  res.json({ chat: shapeChat(chat, adminIdOf(req)), messages: chatMessages(chat.id, Number(req.query.after) || 0) });
});

// Claim only works while nobody holds the chat, so two admins can never both get it.
app.put("/api/admin/chats/:id/claim", admin, (req, res) => {
  const me = adminIdOf(req);
  const id = Number(req.params.id);
  const done = db.transaction(() => {
    const info = db.prepare("UPDATE chats SET admin_id = ? WHERE id = ? AND status = 'open' AND admin_id IS NULL").run(me, id);
    if (info.changes === 0) return false;
    addMessage(id, "system", null, agentName(me) + " has joined the chat and will assist you.");
    return true;
  })();
  if (!done) return res.status(409).json({ error: "This chat is closed or already claimed by another admin." });
  res.json({ ok: true });
});

// Only the admin holding the chat can release it. After that anyone can claim it.
app.put("/api/admin/chats/:id/release", admin, (req, res) => {
  const me = adminIdOf(req);
  const id = Number(req.params.id);
  const done = db.transaction(() => {
    const info = db.prepare("UPDATE chats SET admin_id = NULL WHERE id = ? AND status = 'open' AND admin_id = ?").run(id, me);
    if (info.changes === 0) return false;
    addMessage(id, "system", null, agentName(me) + " has left the chat. Please wait while another agent takes over.");
    return true;
  })();
  if (!done) return res.status(409).json({ error: "You haven't claimed this chat." });
  res.json({ ok: true });
});

app.post("/api/admin/chats/:id/messages", admin, (req, res) => {
  const me = adminIdOf(req);
  const chat = db.prepare("SELECT id, status, admin_id FROM chats WHERE id = ?").get(Number(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.status !== "open") return res.status(400).json({ error: "This chat is closed." });
  if (chat.admin_id !== me) return res.status(409).json({ error: "Claim this chat before replying." });
  const body = chatText(req.body.body);
  if (!body) return res.status(400).json({ error: "Type a message first." });
  addMessage(chat.id, "admin", me, body);
  res.json({ ok: true });
});

app.put("/api/admin/chats/:id/close", admin, (req, res) => {
  const me = adminIdOf(req);
  const chat = db.prepare("SELECT id, status, admin_id FROM chats WHERE id = ?").get(Number(req.params.id));
  if (!chat) return res.status(404).json({ error: "Chat not found." });
  if (chat.status !== "open" || chat.admin_id !== me) return res.status(409).json({ error: "You can only close a chat you've claimed." });
  endChat(chat.id, agentName(me) + " closed this chat.");
  res.json({ ok: true });
});

app.get(
  ["/search", "/product/:slug", "/login", "/register",
   "/account", "/account/:section", "/purchases", "/purchases/:section"],
  (req, res) => res.sendFile(path.join(__dirname, "public", "index.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Running at http://localhost:" + PORT));