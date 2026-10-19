let currentUser = null;
let products = []; 
let cart = [];      // { id, name, price, qty, max }
let currentProduct = null;
let images = [];
let imgIndex = 0;
let returnTo = "/"; // where to go after logging in

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
  return await res.json();
}

async function doLogin() {
  const data = await authenticate(
    document.getElementById("username").value.trim(),
    document.getElementById("password").value
  );
  if (data.error) {
    document.getElementById("error").textContent = data.error;
    return;
  }
  finishAuth(data);
}

function goToRolePage() {
  window.location.href = "/" + currentUser.role;
}

// ---------- WHO IS LOGGED IN ----------

function applyUser(user) {
  currentUser = user;
  chatUserChanged(); 
  document.getElementById("guest-bar").hidden = !!user;
  document.getElementById("user-bar").hidden = !user;
  document.getElementById("cart-btn").hidden = !user;

  if (!user) {
    cart = [];
    document.getElementById("cart-overlay").hidden = true;
    renderCart();
    return;
  }

  document.getElementById("password").value = "";
  document.getElementById("who").textContent =
  user.role === "customer" ? user.username : user.username + " (" + user.role + ")";

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
  loadCart();
}

// Sends a guest to the login page and remembers where they were
function goLogin() {
  if (location.pathname !== "/login" && location.pathname !== "/register") {
    returnTo = location.pathname + location.search;
  }
  navigate("/login");
}

function finishAuth(user) {
  applyUser(user);
  history.replaceState({ app: true }, "", returnTo);
  returnTo = "/";
  route();
}

async function doLogout() {
  document.activeElement.blur(); // closes the dropdown menu
  if (!(await confirmAction("Are you sure you want to log out?", "Log out"))) return;
  await fetch("/api/logout", { method: "POST" });
  applyUser(null);
  route();
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

    const label = document.createElement("div");
    label.className = "product-name";
    const marquee = document.createElement("div");
    marquee.className = "marquee";
    const text = document.createElement("span");
    text.textContent = p.name;
    marquee.appendChild(text);
    label.appendChild(marquee);
    card.appendChild(label);

    card.onclick = () => navigate("/product/" + p.slug);
    list.appendChild(card);
  });

  // Measure once the cards are in the page, then scroll only names that don't fit
  requestAnimationFrame(() => {
    document.querySelectorAll(".marquee").forEach(m => {
      const span = m.firstChild;
      const overflow = span.offsetWidth - m.clientWidth;
      if (overflow > 0) {
        span.style.setProperty("--shift", -overflow + "px");
        span.classList.add("scroll");
      }
    });
  });
}

// ---------- PAGES + LINKS ----------

// Moves to a new link without reloading the page
function navigate(url) {
  history.pushState({ app: true }, "", url);
  route();
}

// Looks at the current link and shows the matching page
function route() {
  const path = location.pathname;
  const onAuthPage = path === "/login" || path === "/register";

  // Logged-in people have no reason to see the login page
  if (onAuthPage && currentUser) {
    history.replaceState({ app: true }, "", "/");
    return route();
  }

  document.getElementById("account-page").hidden = true;

  document.getElementById("login-page").hidden = path !== "/login";
  document.getElementById("register-page").hidden = path !== "/register";
  document.getElementById("app-page").hidden = onAuthPage;
  if (onAuthPage) {
    document.getElementById("error").textContent = "";
    document.getElementById("register-error").textContent = "";
    return;
  }

  const params = new URLSearchParams(location.search);
  const match = path.match(/^\/product\/([^/]+)$/);
  if (match) {
    showProductPage(decodeURIComponent(match[1]).toLowerCase());
    return;
  }
  const acct = path.match(/^\/(account|purchases)(?:\/([a-z]+))?$/);
  if (acct) {
    showAccountPage(acct[1], acct[2]);
    return;
  }

  const isSearch = path === "/search";
  document.getElementById("search").value = isSearch ? (params.get("q") || "") : "";
  document.getElementById("category").value = isSearch ? (params.get("category") || "") : "";
  document.getElementById("product-page").hidden = true;
  document.getElementById("customer-view").hidden = false;
  loadProducts();
}

function doSearch() {
  const q = document.getElementById("search").value.trim();
  const category = document.getElementById("category").value;
  if (!q && !category) return navigate("/");
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  navigate("/search?" + params);
}

async function showProductPage(slug) {
  const res = await fetch("/api/products/" + encodeURIComponent(slug));
  if (!res.ok) {
    showToast("Product not found.", "error");
    history.replaceState({ app: true }, "", "/");
    route();
    return;
  }
  currentProduct = await res.json();
  images = currentProduct.images;
  imgIndex = 0;

  document.getElementById("product-title").textContent = currentProduct.name;
  document.getElementById("product-desc").textContent = currentProduct.description;
  document.getElementById("product-stock").textContent = "Stock: " + currentProduct.amount;
  document.getElementById("product-price").textContent = "PHP " + currentProduct.price;

  const addBtn = document.getElementById("detail-add-btn");
  addBtn.disabled = currentProduct.amount <= 0;
  if (currentProduct.amount <= 0) addBtn.textContent = "Out of stock";
  else if (!currentUser) addBtn.textContent = "Log in to add to cart";
  else addBtn.textContent = "Add to cart";

  renderImage();
  document.getElementById("customer-view").hidden = true;
  document.getElementById("product-page").hidden = false;
}

// Back goes to the page you came from. If the product link was opened directly, it goes to the shop.
function closeProduct() {
  if (history.state && history.state.app) history.back();
  else navigate("/");
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
  if (!currentUser) {
    goLogin();
    return false;
  }

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

// Shows the "are you sure" popup with any message and button label
function confirmAction(text, yesLabel, noLabel) {
  return new Promise(resolve => {
    const overlay = document.getElementById("confirm-overlay");
    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");
    document.getElementById("confirm-text").textContent = text;
    yes.textContent = yesLabel;
    no.textContent = noLabel || "Cancel";
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

function confirmRemove(name) {
  return confirmAction('Remove "' + name + '" from your cart?', "Remove");
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
    body: JSON.stringify({
      username, password,
      first_name: document.getElementById("reg-first").value,
      middle_initial: document.getElementById("reg-mi").value,
      last_name: document.getElementById("reg-last").value,
      name_extension: document.getElementById("reg-ext").value,
      email: document.getElementById("reg-email").value,
      phone: document.getElementById("reg-phone").value,
      street: document.getElementById("reg-street").value,
      barangay: document.getElementById("reg-barangay").value,
      city: document.getElementById("reg-city").value,
      province: document.getElementById("reg-province").value,
      postal_code: document.getElementById("reg-postal").value,
      notes: document.getElementById("reg-notes").value
    })
  });
  
  const data = await res.json();
  if (!res.ok) {
    error.textContent = data.error;
    return;
  }

  error.textContent = "";
  ["reg-username", "reg-password", "reg-confirm", "reg-first", "reg-mi", "reg-last", "reg-ext", "reg-email", "reg-phone", "reg-street", "reg-barangay", 
    "reg-city", "reg-province", "reg-postal", "reg-notes"].forEach(id => document.getElementById(id).value = "");
  finishAuth(data);
}

// ---------- BUTTONS ----------

document.getElementById("login-btn").addEventListener("click", doLogin);
document.getElementById("logout-btn").addEventListener("click", doLogout);
document.getElementById("switch-btn").addEventListener("click", goToRolePage);
document.getElementById("show-register-btn").addEventListener("click", () => navigate("/register"));
document.getElementById("back-to-login-btn").addEventListener("click", () => navigate("/login"));
document.getElementById("open-login-btn").addEventListener("click", goLogin);
document.getElementById("register-btn").addEventListener("click", doRegister);
document.getElementById("back-btn").addEventListener("click", closeProduct);
document.getElementById("prev-btn").addEventListener("click", () => changeImage(-1));
document.getElementById("next-btn").addEventListener("click", () => changeImage(1));
document.getElementById("category").addEventListener("change", doSearch);
document.getElementById("account-btn").addEventListener("click", () => {
  document.activeElement.blur();
  navigate("/account/profile");
});
document.getElementById("purchases-btn").addEventListener("click", () => {
  document.activeElement.blur();
  navigate("/purchases/status");
});
document.querySelectorAll(".account-nav a").forEach(a =>
  a.addEventListener("click", e => {
    e.preventDefault();
    navigate(a.getAttribute("href"));
  })
);
document.getElementById("detail-add-btn").addEventListener("click", async () => {
  if (await addToCart(currentProduct)) showToast("Added to cart.", "success");
});
document.getElementById("search").addEventListener("keydown", e => {
  if (e.key === "Enter") doSearch();
});

// Browser back/forward buttons
window.addEventListener("popstate", route);

// Cart overlay
const cartOverlay = document.getElementById("cart-overlay");
document.getElementById("cart-btn").addEventListener("click", () => { cartOverlay.hidden = false; });
document.getElementById("cart-close-btn").addEventListener("click", () => { cartOverlay.hidden = true; });

cartOverlay.addEventListener("click", e => {
  if (e.target === cartOverlay) cartOverlay.hidden = true;
});

document.getElementById("checkout-btn").addEventListener("click", async () => {
  if (!(await confirmAction("Place this order? Payment is cash on delivery (COD).", "Place order"))) return;
  const data = await send("POST", "/api/checkout", {});
  if (!data) return;
  cartOverlay.hidden = true;
  await loadCart();
  showToast("Order placed. Waiting for approval.", "success");
  navigate("/purchases/status");
});

// Pressing Enter in the password box also logs in
document.getElementById("password").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

// ---------- ACCOUNT + PURCHASES PAGES ----------

const val = id => document.getElementById(id).value;

function makeField(label, id, value, type) {
  const l = document.createElement("label");
  l.className = "field";
  l.textContent = label;
  const i = document.createElement("input");
  i.type = type || "text";
  i.id = id;
  i.value = value || "";
  l.appendChild(i);
  return l;
}

function makeButton(text, onclick, className) {
  const b = document.createElement("button");
  b.className = className || "primary-btn";
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function makeHeading(text) {
  const h = document.createElement("h2");
  h.textContent = text;
  return h;
}

// Sends JSON. Shows the error as a toast and returns null if it failed.
async function send(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(data.error || "Something went wrong.", "error");
    return null;
  }
  return data;
}

async function renderProfile(box) {
  const res = await fetch("/api/profile");
  if (!res.ok) return;
  const p = await res.json();
  box.append(
    makeHeading("Profile"),
    makeField("Username", "pf-username", p.username),
    makeField("First name", "pf-first", p.first_name),
    makeField("Middle initial (optional)", "pf-mi", p.middle_initial),
    makeField("Last name", "pf-last", p.last_name),
    makeField("Extension (optional)", "pf-ext", p.name_extension),
    makeField("Email", "pf-email", p.email, "email"),
    makeField("Mobile number", "pf-phone", p.phone, "tel"),
    makeButton("Save changes", async () => {
      const user = await send("PUT", "/api/profile", {
        username: val("pf-username"), first_name: val("pf-first"),
        middle_initial: val("pf-mi"), last_name: val("pf-last"),
        name_extension: val("pf-ext"), email: val("pf-email"), phone: val("pf-phone")
      });
      if (user) {
        applyUser(user);
        showToast("Profile saved.", "success");
      }
    })
  );
}

async function renderPayment(box) {
  const p = document.createElement("p");
  p.textContent = "Payment info is coming soon.";
  box.append(makeHeading("Payment info"), p);
}

async function reloadAddresses() {
  const box = document.getElementById("account-content");
  box.innerHTML = "";
  await renderAddresses(box);
}

async function renderAddresses(box) {
  const res = await fetch("/api/addresses");
  if (!res.ok) return;
  const list = await res.json();
  box.appendChild(makeHeading("Addresses"));

  if (list.length === 0) {
    const p = document.createElement("p");
    p.textContent = "You have no saved addresses yet.";
    box.appendChild(p);
  }

  list.forEach(a => {
    const card = document.createElement("div");
    card.className = "order-card address-card";

    const head = document.createElement("div");
    head.className = "order-head";
    const title = document.createElement("b");
    title.textContent = a.label || "Address";
    head.appendChild(title);
    if (a.is_default) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Default";
      head.appendChild(badge);
    }

    const who = document.createElement("div");
    who.textContent = a.recipient_name + " \u00b7 " + a.phone;
    const where = document.createElement("div");
    where.textContent = [a.street, a.barangay, a.city, a.province, a.postal_code]
      .filter(Boolean).join(", ");
    card.append(head, who, where);

    if (a.notes) {
      const notes = document.createElement("small");
      notes.textContent = "Note: " + a.notes;
      card.appendChild(notes);
    }

    const actions = document.createElement("div");
    actions.className = "address-actions";
    actions.appendChild(makeButton("Edit", () => showAddressForm(a), "secondary-btn"));
    if (!a.is_default) {
      actions.appendChild(makeButton("Set as default", async () => {
        if (await send("PUT", "/api/addresses/" + a.id + "/default", {})) reloadAddresses();
      }, "secondary-btn"));
    }
    actions.appendChild(makeButton("Delete", async () => {
      if (!(await confirmAction("Delete this address?", "Delete"))) return;
      if (await send("DELETE", "/api/addresses/" + a.id)) {
        showToast("Address deleted.", "success");
        reloadAddresses();
      }
    }, "secondary-btn"));
    card.appendChild(actions);
    box.appendChild(card);
  });

  if (list.length < 10) {
    box.appendChild(makeButton("+ Add new address", () => showAddressForm(null)));
  }
}

// One form for both adding (a is null) and editing
async function showAddressForm(a) {
  let d = a || {};
  if (!a) {
    // Prefill the phone and name from the profile to save typing
    const pr = await fetch("/api/profile");
    if (pr.ok) {
      const p = await pr.json();
      d = { phone: p.phone, recipient_name: [p.first_name, p.last_name].filter(Boolean).join(" ") };
    }
  }
  const box = document.getElementById("account-content");
  box.innerHTML = "";
  box.append(
    makeHeading(a ? "Edit address" : "Add address"),
    makeField("Label (optional, like Home or Work)", "ad-label", d.label),
    makeField("Recipient name", "ad-name", d.recipient_name),
    makeField("Mobile number", "ad-phone", d.phone, "tel"),
    makeField("House no. / Street", "ad-street", d.street),
    makeField("Barangay", "ad-barangay", d.barangay),
    makeField("City / Municipality", "ad-city", d.city),
    makeField("Province", "ad-province", d.province),
    makeField("Postal code (optional)", "ad-postal", d.postal_code),
    makeField("Delivery notes (optional)", "ad-notes", d.notes)
  );
  const actions = document.createElement("div");
  actions.className = "address-actions";
  actions.append(
    makeButton("Save address", async () => {
      const body = {
        label: val("ad-label"), recipient_name: val("ad-name"), phone: val("ad-phone"),
        street: val("ad-street"), barangay: val("ad-barangay"), city: val("ad-city"),
        province: val("ad-province"), postal_code: val("ad-postal"), notes: val("ad-notes")
      };
      const data = await send(a ? "PUT" : "POST", a ? "/api/addresses/" + a.id : "/api/addresses", body);
      if (data) {
        showToast("Address saved.", "success");
        reloadAddresses();
      }
    }),
    makeButton("Cancel", reloadAddresses, "secondary-btn")
  );
  box.appendChild(actions);
}

async function renderPassword(box) {
  box.append(
    makeHeading("Change password"),
    makeField("Current password", "pw-current", "", "password"),
    makeField("New password", "pw-new", "", "password"),
    makeField("Confirm new password", "pw-confirm", "", "password"),
    makeButton("Change password", async () => {
      const problem = checkPassword(val("pw-new"));
      if (problem) return showToast(problem, "error");
      if (val("pw-new") !== val("pw-confirm")) return showToast("Passwords don't match.", "error");
      const data = await send("PUT", "/api/password", {
        current_password: val("pw-current"), new_password: val("pw-new")
      });
      if (data) {
        ["pw-current", "pw-new", "pw-confirm"].forEach(id => document.getElementById(id).value = "");
        showToast("Password changed.", "success");
      }
    })
  );
}

async function renderDelete(box) {
  const warn = document.createElement("p");
  warn.textContent = "This permanently deletes your account, saved details and cart. This can't be undone.";
  box.append(
    makeHeading("Delete account"),
    warn,
    makeField("Enter your password to confirm", "del-password", "", "password"),
    makeButton("Delete my account", async () => {
      if (!(await confirmAction("Delete your account for good?", "Delete"))) return;
      const data = await send("DELETE", "/api/account", { password: val("del-password") });
      if (data) {
        applyUser(null);
        navigate("/");
        showToast("Your account was deleted.", "success");
      }
    }, "danger-btn")
  );
}

async function loadOrders() {
  const res = await fetch("/api/orders");
  return res.ok ? await res.json() : [];
}

const STATUS_TEXT = {
  pending: "Waiting for the shop to approve your order",
  in_progress: "Approved - the shop is preparing your order",
  paid: "Paid",
  packed: "Packed",
  shipped: "On its way",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned"
};

function renderOrderList(box, title, orders, emptyText) {
  box.appendChild(makeHeading(title));
  if (orders.length === 0) {
    const p = document.createElement("p");
    p.textContent = emptyText;
    box.appendChild(p);
    return;
  }
  orders.forEach(o => {
    const card = document.createElement("div");
    card.className = "order-card";

    const head = document.createElement("div");
    head.className = "order-head";
    const idText = document.createElement("b");
    idText.textContent = "Order #" + o.id;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = o.status.replace("_", " ");
    head.append(idText, badge);

    const statusLine = document.createElement("small");
    statusLine.textContent = STATUS_TEXT[o.status] || o.status;

    const date = document.createElement("small");
    date.textContent = new Date(o.created_at.replace(" ", "T") + "Z").toLocaleDateString();

    card.append(head, statusLine, date);
    o.items.forEach(i => {
      const line = document.createElement("div");
      line.textContent = i.name + " \u00d7 " + i.qty;
      card.appendChild(line);
    });
    const total = document.createElement("b");
    total.textContent = "Total: PHP " + o.total.toFixed(2);
    card.appendChild(total);

    if (o.status === "pending" || o.status === "in_progress") {
      card.appendChild(makeButton("Cancel order", async () => {
        if (!(await confirmAction("Cancel order #" + o.id + "?", "Cancel order", "Keep order"))) return;
        if (await send("PUT", "/api/orders/" + o.id + "/cancel", {})) {
          showToast("Order cancelled.", "success");
          route(); // reloads the page; the order now shows under Cancelled & returns
        }
      }, "danger-btn"));
    }
    box.appendChild(card);
  });
}

async function renderStatus(box) {
  const active = ["pending", "in_progress", "paid", "packed", "shipped"];
  const orders = (await loadOrders()).filter(o => active.includes(o.status));
  renderOrderList(box, "Order status", orders, "You have no orders in progress.");
}

async function renderHistory(box) {
  const orders = (await loadOrders()).filter(o => o.status === "delivered");
  renderOrderList(box, "Order history", orders, "No completed orders yet.");
}

async function renderReturns(box) {
  const orders = (await loadOrders()).filter(o => ["cancelled", "returned"].includes(o.status));
  renderOrderList(box, "Cancelled & returns", orders, "No cancelled or returned orders.");
}

const SECTIONS = {
  account: {
    profile: renderProfile, payment: renderPayment, addresses: renderAddresses,
    password: renderPassword, delete: renderDelete
  },
  purchases: { status: renderStatus, history: renderHistory, returns: renderReturns }
};

async function showAccountPage(group, section) {
  if (!currentUser) return goLogin();
  if (!SECTIONS[group][section]) {
    history.replaceState({ app: true }, "", group === "account" ? "/account/profile" : "/purchases/status");
    return route();
  }
  document.getElementById("customer-view").hidden = true;
  document.getElementById("product-page").hidden = true;
  document.getElementById("account-page").hidden = false;
  document.querySelectorAll(".account-nav a").forEach(a =>
    a.classList.toggle("active", a.getAttribute("href") === location.pathname));

  const box = document.getElementById("account-content");
  box.innerHTML = "";
  await SECTIONS[group][section](box);
}

// On page load, find out who is logged in (if anyone), then show the page for the current link
fetch("/api/me").then(res => res.ok ? res.json() : null).then(user => {
  applyUser(user);
  route();
});