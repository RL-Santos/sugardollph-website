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

app.listen(3000, () => console.log("Running at http://localhost:3000"));