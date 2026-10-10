let currentUser = null;
let products = [];  // results from the server
let cart = [];      // { id, name, price, qty, max }
let currentProduct = null;
let images = [];
let imgIndex = 0;

// Shows a popup in the bottom right corner for a few seconds
function showToast(text, type) {
  const toast = document.createElement("div");
  toast.className = "toast " + (type || "");
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

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
  document.getElementById("customer-view").hidden = false;
  document.getElementById("product-page").hidden = true;

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
  document.getElementById("cart-overlay").hidden = true;
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
    list.textContent = "No products found.";
    return;
  }
  products.forEach(p => {
    const card = document.createElement("button");
    card.className = "product-card";

    if (p.image) {
      const img = document.createElement("img");
      img.src = p.image;
      img.alt = p.name;
      card.appendChild(img);
    } else {
      const none = document.createElement("div");
      none.className = "no-image";
      none.textContent = "No image";
      card.appendChild(none);
    }

    const title = document.createElement("b");
    title.textContent = p.name;
    const price = document.createElement("span");
    price.textContent = "PHP " + p.price;
    card.append(title, price);

    card.onclick = () => openProduct(p.id);
    list.appendChild(card);
  });
}

// ---------- PRODUCT PAGE ----------

async function openProduct(id) {
  const res = await fetch("/api/products/" + id);
  if (!res.ok) return;
  currentProduct = await res.json();
  images = currentProduct.images;
  imgIndex = 0;

  document.getElementById("product-title").textContent = currentProduct.name;
  document.getElementById("product-desc").textContent = currentProduct.description;
  document.getElementById("product-stock").textContent = "Stock: " + currentProduct.amount;
  document.getElementById("product-price").textContent = "PHP " + currentProduct.price;

  const addBtn = document.getElementById("detail-add-btn");
  addBtn.disabled = currentProduct.amount <= 0;
  addBtn.textContent = currentProduct.amount > 0 ? "Add to cart" : "Out of stock";

  renderImage();
  document.getElementById("customer-view").hidden = true;
  document.getElementById("product-page").hidden = false;
}

function renderImage() {
  const img = document.getElementById("product-img");
  const many = images.length > 1;
  img.hidden = images.length === 0;
  document.getElementById("prev-btn").hidden = !many;
  document.getElementById("next-btn").hidden = !many;
  document.getElementById("img-count").textContent =
    images.length ? (imgIndex + 1) + " / " + images.length : "No pictures yet";
  if (images.length) {
    img.src = images[imgIndex];
    img.alt = currentProduct.name;
  }
}

// Wraps around: after the last picture comes the first, and before the first comes the last
function changeImage(step) {
  imgIndex = (imgIndex + step + images.length) % images.length;
  renderImage();
}

function closeProduct() {
  document.getElementById("product-page").hidden = true;
  document.getElementById("customer-view").hidden = false;
  loadProducts(); // refresh stock numbers
}
// ---------- CART ----------

async function loadCart() {
  const res = await fetch("/api/cart");
  if (res.ok) cart = await res.json();
  renderCart();
}

async function saveQty(id, qty) {
  const res = await fetch("/api/cart/" + id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qty })
  });
  const data = await res.json();
  if (!res.ok) {
    showToast(data.error, "error");
    return false;
  }
  cart = data;
  renderCart();
  return true;
}

async function addToCart(p) {
  const item = cart.find(i => i.id === p.id);
  if (item && item.qty >= item.max) {
    showToast("No more stock available.", "error");
    return false;
  }
  return saveQty(p.id, item ? item.qty + 1 : 1);
}

function changeQty(item, change) {
  const newQty = item.qty + change;
  if (newQty <= 0) return askRemove(item);
  if (newQty > item.max) {
    showToast("No more stock available.", "error");
    return;
  }
  saveQty(item.id, newQty);
}

// Shows the "are you sure" popup
function confirmRemove(name) {
  return new Promise(resolve => {
    const overlay = document.getElementById("confirm-overlay");
    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");
    document.getElementById("confirm-text").textContent =
      'Remove "' + name + '" from your cart?';
    overlay.hidden = false;
    const finish = answer => {
      overlay.hidden = true;
      yes.onclick = null;
      no.onclick = null;
      resolve(answer);
    };
    yes.onclick = () => finish(true);
    no.onclick = () => finish(false);
  });
}

async function askRemove(item) {
  if (!(await confirmRemove(item.name))) return;
  const res = await fetch("/api/cart/" + item.id, { method: "DELETE" });
  if (res.ok) {
    cart = await res.json();
    renderCart();
  }
}

function renderCart() {
  document.getElementById("cart-count").textContent = cart.reduce((n, i) => n + i.qty, 0);

  const box = document.getElementById("cart");
  const footer = document.getElementById("cart-footer");
  box.innerHTML = "";

  if (cart.length === 0) {
    box.textContent = "Your cart is empty.";
    footer.hidden = true;
    return;
  }

  let total = 0;
  cart.forEach(item => {
    total += item.price * item.qty;

    const card = document.createElement("div");
    card.className = "cart-item";

    const remove = document.createElement("button");
    remove.className = "cart-remove";
    remove.textContent = "\u2715";
    remove.title = "Remove";
    remove.onclick = () => askRemove(item);

    let thumb;
    if (item.image) {
      thumb = document.createElement("img");
      thumb.src = item.image;
      thumb.alt = item.name;
    } else {
      thumb = document.createElement("div");
    }
    thumb.className = "cart-thumb";

    const info = document.createElement("div");
    info.className = "cart-info";

    const name = document.createElement("b");
    name.textContent = item.name;

    const price = document.createElement("span");
    price.textContent = "PHP " + item.price;

    const qty = document.createElement("div");
    qty.className = "cart-qty";
    const minus = document.createElement("button");
    minus.textContent = "-";
    minus.onclick = () => changeQty(item, -1);
    const amount = document.createElement("span");
    amount.textContent = item.qty;
    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.onclick = () => changeQty(item, 1);
    qty.append(minus, amount, plus);

    info.append(name, price, qty);
    card.append(remove, thumb, info);
    box.appendChild(card);
  });

  document.getElementById("cart-total").textContent = "Total: PHP " + total.toFixed(2);
  footer.hidden = false;
}

// ---------- CREATE ACCOUNT ----------

function showRegister(show) {
  document.getElementById("error").textContent = "";
  document.getElementById("register-error").textContent = "";
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
  showApp(data);
}

// ---------- BUTTONS ----------

document.getElementById("login-btn").addEventListener("click", doLogin);
document.getElementById("logout-btn").addEventListener("click", doLogout);
document.getElementById("switch-btn").addEventListener("click", goToRolePage);
document.getElementById("search").addEventListener("input", closeProduct);
document.getElementById("category").addEventListener("change", closeProduct);
document.getElementById("show-register-btn").addEventListener("click", () => showRegister(true));
document.getElementById("back-to-login-btn").addEventListener("click", () => showRegister(false));
document.getElementById("register-btn").addEventListener("click", doRegister);
document.getElementById("back-btn").addEventListener("click", closeProduct);
document.getElementById("prev-btn").addEventListener("click", () => changeImage(-1));
document.getElementById("next-btn").addEventListener("click", () => changeImage(1));
document.getElementById("detail-add-btn").addEventListener("click", async () => {
  if (await addToCart(currentProduct)) showToast("Added to cart.", "success");
});

// Cart overlay
const cartOverlay = document.getElementById("cart-overlay");
document.getElementById("cart-btn").addEventListener("click", () => { cartOverlay.hidden = false; });
document.getElementById("cart-close-btn").addEventListener("click", () => { cartOverlay.hidden = true; });
cartOverlay.addEventListener("click", e => {
  if (e.target === cartOverlay) cartOverlay.hidden = true;
});

// Pressing Enter in the password box also logs in
document.getElementById("password").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

// On page load: if the server still has a session, skip the login screen.
fetch("/api/me").then(res => res.ok ? res.json() : null).then(user => {
  if (user) showApp(user);
});