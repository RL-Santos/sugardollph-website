let currentUser = null;
let products = [];  // results from the server
let cart = [];      // { id, name, price, qty, max }

// ---------- LOGIN ----------

async function authenticate(username, password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  return res.ok ? await res.json() : null;
}

async function doLogin() {
  const user = await authenticate(
    document.getElementById("username").value.trim(),
    document.getElementById("password").value
  );
  if (!user) {
    document.getElementById("error").textContent = "Wrong username or password.";
    return;
  }
  showApp(user);
}

function showApp(user) {
  currentUser = user;
  document.getElementById("error").textContent = "";
  document.getElementById("password").value = "";
  document.getElementById("login-page").hidden = true;
  document.getElementById("register-page").hidden = true;
  document.getElementById("app-page").hidden = false;
  document.getElementById("who").textContent = user.username + " (" + user.role + ")";

  const btn = document.getElementById("switch-btn");
  if (user.role === "admin") {
    btn.textContent = "Go to admin page";
    btn.hidden = false;
  } else if (user.role === "warehouse") {
    btn.textContent = "Go to warehouse page";
    btn.hidden = false;
  } else {
    btn.hidden = true;
  }

  loadProducts();
  renderCart();
}

async function doLogout() {
  await fetch("/api/logout", { method: "POST" });
  currentUser = null;
  cart = [];
  document.getElementById("app-page").hidden = true;
  document.getElementById("login-page").hidden = false;
}

function goToRolePage() {
  window.location.href = "/" + currentUser.role;
}

// ---------- PRODUCTS + SEARCH ----------

async function loadProducts() {
  const q = document.getElementById("search").value.trim();
  const category = document.getElementById("category").value;
  const res = await fetch(
    "/api/products?search=" + encodeURIComponent(q) +
    "&category=" + encodeURIComponent(category)
  );
  if (!res.ok) return;
  products = await res.json();
  renderProducts();
}

function renderProducts() {
  const list = document.getElementById("product-list");
  list.innerHTML = "";
  if (products.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No products found.";
    list.appendChild(li);
    return;
  }
  products.forEach(p => {
    const li = document.createElement("li");
    li.textContent = p.name + " - PHP " + p.price + " - " + p.description +
                     " (" + p.amount + " in stock) ";
    const btn = document.createElement("button");
    btn.textContent = p.amount > 0 ? "Add to cart" : "Out of stock";
    btn.disabled = p.amount <= 0;
    btn.onclick = () => addToCart(p);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

// ---------- CART ----------

function addToCart(p) {
  const item = cart.find(i => i.id === p.id);
  if (item) {
    if (item.qty < item.max) item.qty++;
  } else {
    cart.push({ id: p.id, name: p.name, price: p.price, qty: 1, max: p.amount });
  }
  renderCart();
}

function changeQty(id, change) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.min(item.qty + change, item.max);
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  renderCart();
}

function removeItem(id) {
  cart = cart.filter(i => i.id !== id);
  renderCart();
}

function renderCart() {
  const box = document.getElementById("cart");
  box.innerHTML = "";
  if (cart.length === 0) {
    box.textContent = "Your cart is empty.";
    return;
  }

  const table = document.createElement("table");
  table.border = "1";
  table.cellPadding = "4";

  const head = table.insertRow();
  ["Product", "Price", "Qty", "Subtotal", ""].forEach(t => {
    const th = document.createElement("th");
    th.textContent = t;
    head.appendChild(th);
  });

  let total = 0;
  cart.forEach(item => {
    const subtotal = item.price * item.qty;
    total += subtotal;

    const row = table.insertRow();
    row.insertCell().textContent = item.name;
    row.insertCell().textContent = "PHP " + item.price;

    const qtyCell = row.insertCell();
    const minus = document.createElement("button");
    minus.textContent = "-";
    minus.onclick = () => changeQty(item.id, -1);
    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.onclick = () => changeQty(item.id, 1);
    qtyCell.append(minus, " " + item.qty + " ", plus);

    row.insertCell().textContent = "PHP " + subtotal.toFixed(2);

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.onclick = () => removeItem(item.id);
    row.insertCell().appendChild(removeBtn);
  });

  box.appendChild(table);
  const totalLine = document.createElement("p");
  const b = document.createElement("b");
  b.textContent = "Total: PHP " + total.toFixed(2);
  totalLine.appendChild(b);
  box.appendChild(totalLine);
}

// ---------- CREATE ACCOUNT ----------

function showRegister(show) {
  document.getElementById("login-page").hidden = show;
  document.getElementById("register-page").hidden = !show;
}

// Same rules as the server, so people see the problem before sending anything.
function checkPassword(password) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (new TextEncoder().encode(password).length > 72) return "Password must be 72 characters or fewer.";
  if (!/[A-Z]/.test(password)) return "Password needs at least 1 uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs at least 1 lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs at least 1 number.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Password needs at least 1 symbol (like ! @ # $).";
  return null;
}

async function doRegister() {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value;
  const confirm = document.getElementById("reg-confirm").value;
  const error = document.getElementById("register-error");
  const problem = checkPassword(password);
  
  if (problem) {
    error.textContent = problem;
    return;
  }

  if (password !== confirm) {
    error.textContent = "Passwords don't match.";
    return;
  }

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) {
    error.textContent = data.error;
    return;
  }

  error.textContent = "";
  document.getElementById("reg-username").value = "";
  document.getElementById("reg-password").value = "";
  document.getElementById("reg-confirm").value = "";
  showApp(data); // logged in right after signing up
}

// ---------- BUTTONS ----------

document.getElementById("login-btn").addEventListener("click", doLogin);
document.getElementById("logout-btn").addEventListener("click", doLogout);
document.getElementById("switch-btn").addEventListener("click", goToRolePage);
document.getElementById("search").addEventListener("input", loadProducts);
document.getElementById("category").addEventListener("change", loadProducts);
document.getElementById("show-register-btn").addEventListener("click", () => showRegister(true));
document.getElementById("back-to-login-btn").addEventListener("click", () => showRegister(false));
document.getElementById("register-btn").addEventListener("click", doRegister);

// Pressing Enter in the password box also logs in
document.getElementById("password").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

// On page load: if the server still has a session, skip the login screen.
fetch("/api/me").then(res => res.ok ? res.json() : null).then(user => {
  if (user) showApp(user);
});