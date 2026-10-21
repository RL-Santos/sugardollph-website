const main = document.getElementById("main");
const ROLES = ["customer", "admin", "warehouse"];
const CATEGORIES = ["jeans", "trousers", "tops", "others"];
const STATUSES = ["pending", "in_progress", "paid", "packed", "shipped", "delivered", "cancelled", "returned"];
const ACTIVE = ["pending", "in_progress", "paid", "packed", "shipped"]; // statuses that can still be cancelled
let me = null;

// ---------- helpers ----------

// Builds an element: h("div", { class: "x", onclick: fn }, child, "text", [more children])
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach(c => e.append(c instanceof Node ? c : document.createTextNode(c ?? "")));
  return e;
}

const money = n => "PHP " + Number(n).toFixed(2);
const when = s => new Date(s.replace(" ", "T") + "Z").toLocaleString();
const label = s => { const t = String(s).replace("_", " "); return t[0].toUpperCase() + t.slice(1); };
const badge = status => h("span", { class: "badge " + status }, label(status));
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const backLink = (href, text) => h("p", {}, h("a", { href, "data-nav": "" }, "\u2190 " + text));

function toast(text, type) {
  const t = h("div", { class: "toast " + (type || "") }, text);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function confirmAction(text, yesLabel, noLabel) {
  return new Promise(resolve => {
    const overlay = document.getElementById("confirm-overlay");
    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");
    document.getElementById("confirm-text").textContent = text;
    yes.textContent = yesLabel;
    no.textContent = noLabel || "Cancel";
    overlay.hidden = false;
    const finish = answer => { overlay.hidden = true; yes.onclick = no.onclick = null; resolve(answer); };
    yes.onclick = () => finish(true);
    no.onclick = () => finish(false);
  });
}

// Talks to the server. Shows an error toast and returns null when it fails.
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { location.href = "/"; return null; }
  if (!res.ok) { toast(data.error || "Something went wrong.", "error"); return null; }
  return data;
}

// ---------- sidebar ----------

const KEY = "adminSidebarCollapsed";
const saved = localStorage.getItem(KEY);
document.body.classList.toggle("collapsed", saved === null ? innerWidth < 700 : saved === "1");
document.getElementById("sidebar-toggle").addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("collapsed");
  localStorage.setItem(KEY, collapsed ? "1" : "0");
});

// ---------- routing ----------

function navigate(url) { history.pushState({}, "", url); route(); }

document.addEventListener("click", e => {
  const a = e.target.closest("a[data-nav]");
  if (a) { e.preventDefault(); navigate(a.getAttribute("href")); }
});
window.addEventListener("popstate", route);

const routes = [
  [/^\/admin\/?$/, viewOverview],
  [/^\/admin\/users\/?$/, viewUsers],
  [/^\/admin\/users\/(\d+)$/, viewUser],
  [/^\/admin\/products\/?$/, viewProducts],
  [/^\/admin\/orders\/?$/, viewOrders],
  [/^\/admin\/orders\/(\d+)$/, viewOrder],
  [/^\/admin\/logs\/?$/, viewLogs],
  [/^\/admin\/chats\/?$/, viewChats],
  [/^\/admin\/chats\/(\d+)$/, viewChat]
];

function route() {
  const p = location.pathname;
  document.querySelectorAll("#sidebar nav a").forEach(a => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === "/admin" ? /^\/admin\/?$/.test(p) : p.startsWith(href));
  });
  for (const [re, view] of routes) {
    const m = p.match(re);
    if (m) {
      const box = h("div");
      main.replaceChildren(box); // a slow, older page can only write into its own detached box
      view(box, m[1]);
      return;
    }
  }
  navigate("/admin");
}

// ---------- overview ----------

async function viewOverview(box) {
  const d = await api("GET", "/api/admin/overview");
  if (!d) return;
  const c = d.counts;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const stat = (name, value, href) =>
    h(href ? "a" : "div", { class: "stat", href, "data-nav": href ? "" : null }, h("b", {}, value), h("span", {}, name));
  const lines = (rows, empty, render) => rows.length ? rows.map(render) : [h("p", {}, empty)];

  box.append(
    h("div", { class: "page-head" }, h("h1", {}, "Overview")),
    h("div", { class: "stats" },
      stat("Requests to review", d.requests, "/admin/orders?status=requests"),
      stat("Pending approval", c.pending || 0, "/admin/orders?status=pending"),
      stat("In progress", c.in_progress || 0, "/admin/orders?status=in_progress"),
      stat("Cancelled", c.cancelled || 0, "/admin/orders?status=cancelled"),
      stat("Total orders", total, "/admin/orders"),
      stat("Revenue (approved orders)", money(d.revenue)),
      stat("Customers", d.customers, "/admin/users"),
      stat("Products", d.products, "/admin/products")),
    h("div", { class: "panels" },
      h("div", { class: "panel" }, h("h2", {}, "Trending products"),
        ...lines(d.trending, "No sales yet.", t =>
          h("div", { class: "line" }, h("span", {}, t.name), h("b", {}, t.sold + " sold")))),
      h("div", { class: "panel" }, h("h2", {}, "Low stock (5 or fewer)"),
        ...lines(d.lowStock, "Nothing is running low.", p =>
          h("div", { class: "line" }, h("span", {}, p.name), h("b", {}, p.amount + " left")))),
      h("div", { class: "panel" }, h("h2", {}, "Recent orders"),
        ...lines(d.recent, "No orders yet.", o =>
          h("a", { class: "line", href: "/admin/orders/" + o.id, "data-nav": "" },
            h("span", {}, "#" + o.id + " " + o.customer), h("span", {}, money(o.total) + " \u00b7 " + label(o.status)))))));
}

// ---------- users ----------

function viewUsers(box) {
  const search = h("input", { type: "search", placeholder: "Search by username, name or email" });
  const list = h("div", { class: "list" });

  async function load() {
    const rows = await api("GET", "/api/admin/users?search=" + encodeURIComponent(search.value.trim()));
    if (rows) list.replaceChildren(...(rows.length ? rows.map(userCard) : ["No users found."]));
  }

  function userCard(u) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
    let actions;
    if (me && u.username === me.username) {
      actions = [h("small", {}, "(you)")];
    } else {
      const roleSel = h("select", {}, ROLES.map(r => h("option", { value: r, selected: r === u.role }, r)));
      actions = [
        roleSel,
        h("button", {
          class: "secondary-btn",
          onclick: async () => {
            if (await api("PUT", `/api/admin/users/${u.id}/role`, { role: roleSel.value })) {
              toast(u.username + " is now " + roleSel.value + ".", "success");
              load();
            }
          }
        }, "Change role"),
        h("button", {
          class: u.active ? "danger-btn" : "secondary-btn",
          onclick: async () => {
            if (u.active && !(await confirmAction(`Deactivate ${u.username}? They won't be able to log in.`, "Deactivate"))) return;
            if (await api("PUT", `/api/admin/users/${u.id}/active`, { active: !u.active })) {
              toast(u.username + (u.active ? " was deactivated." : " was activated."), "success");
              load();
            }
          }
        }, u.active ? "Deactivate" : "Activate")
      ];
    }
    return h("div", { class: "row-card clickable", onclick: () => navigate("/admin/users/" + u.id) },
      h("div", { class: "row-info" },
        h("b", {}, u.username, " ", h("span", { class: "badge" }, u.role),
          u.active ? "" : [" ", h("span", { class: "badge cancelled" }, "deactivated")]),
        h("small", {}, [name, u.email].filter(Boolean).join(" \u00b7 ") || "No profile info"),
        h("small", {}, u.orders + " order(s)")),
      h("div", { class: "row-actions", onclick: e => e.stopPropagation() }, actions));
  }

  search.addEventListener("input", debounce(load));
  box.append(h("div", { class: "page-head" }, h("h1", {}, "Manage Users")),
    h("div", { class: "toolbar" }, search), list);
  load();
}

async function viewUser(box, id) {
  const u = await api("GET", "/api/admin/users/" + id);
  if (!u) return navigate("/admin/users");
  const p = u.profile || {};
  const name = [p.first_name, p.middle_initial && p.middle_initial + ".", p.last_name, p.name_extension]
    .filter(Boolean).join(" ");
  const info = [["Username", u.username], ["Role", u.role], ["Status", u.active ? "Active" : "Deactivated"],
    ["Name", name || "\u2014"], ["Email", p.email || "\u2014"], ["Mobile", p.phone || "\u2014"]];

  box.append(
    backLink("/admin/users", "Back to users"),
    h("div", { class: "page-head" }, h("h1", {}, u.username)),
    h("div", { class: "panel" }, h("dl", { class: "info-grid" },
      info.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))),
    h("h2", {}, "Addresses"),
    h("div", { class: "list" }, u.addresses.length ? u.addresses.map(a =>
      h("div", { class: "row-card" }, h("div", { class: "row-info" },
        h("b", {}, a.label || "Address", a.is_default ? [" ", h("span", { class: "badge" }, "Default")] : ""),
        h("small", {}, a.recipient_name + " \u00b7 " + a.phone),
        h("small", {}, [a.street, a.barangay, a.city, a.province, a.postal_code].filter(Boolean).join(", ")),
        a.notes ? h("small", {}, "Note: " + a.notes) : ""))) : "No saved addresses."),
    h("h2", {}, "Orders (" + u.orders.length + ")"),
    h("div", { class: "list" }, u.orders.length ? u.orders.map(o => orderCard(o)) : "No orders yet."));
}

// ---------- orders ----------

const approveBtn = (o, done) => h("button", {
  class: "primary-btn",
  onclick: async () => {
    if (await api("PUT", `/api/admin/orders/${o.id}/approve`)) { toast("Order #" + o.id + " approved.", "success"); done(); }
  }
}, "Approve");

const cancelBtn = (o, done) => h("button", {
  class: "danger-btn",
  onclick: async () => {
    const ok = await confirmAction(
      `Cancel order #${o.id}? The customer will see it under Cancelled & returns.`, "Cancel order", "Keep order");
    if (ok && await api("PUT", `/api/admin/orders/${o.id}/cancel`)) { toast("Order #" + o.id + " cancelled.", "success"); done(); }
  }
}, "Cancel order");

// Approve / Reject buttons for a customer's cancel or return request
function requestButtons(o, done) {
  return ["cancel", "return"].filter(k => o[k + "_status"] === "pending").flatMap(k => {
    const word = k === "cancel" ? "cancellation" : "return";
    const decide = (decision, text, cls) => h("button", {
      class: cls,
      onclick: async () => {
        if (!(await confirmAction(`${text} the ${word} request for order #${o.id}?`, text))) return;
        if (await api("PUT", `/api/admin/orders/${o.id}/requests/${k}`, { decision })) {
          toast("Request " + (decision === "approve" ? "approved" : "rejected") + ".", "success");
          done();
        }
      }
    }, text + " " + word);
    return [decide("approve", "Approve", "primary-btn"), decide("reject", "Reject", "secondary-btn")];
  });
}

const requestNote = o => ["cancel", "return"].filter(k => o[k + "_status"] === "pending")
  .map(k => h("small", { class: "req-note" },
    (k === "cancel" ? "Cancellation" : "Return") + " requested: " + (o[k + "_reason"] || "no reason given")));

// A clickable order card. Pass `reload` to show the Approve / Cancel buttons.
function orderCard(o, reload) {
  const actions = [];
  if (reload && o.status === "pending") actions.push(approveBtn(o, reload));
  if (reload && ACTIVE.includes(o.status)) actions.push(cancelBtn(o, reload));
  if (reload) actions.push(...requestButtons(o, reload));
  return h("div", { class: "row-card clickable", onclick: () => navigate("/admin/orders/" + o.id) },
    h("div", { class: "row-info" },
      h("b", {}, "Order #" + o.id, " ", badge(o.status)),
      h("small", {}, (o.username || o.ship_name || "Deleted account") + " \u00b7 " + when(o.created_at)),
      h("small", {}, o.items.map(i => i.name + " \u00d7" + i.qty).join(", ")),
      requestNote(o)),
    h("div", { class: "row-actions", onclick: e => e.stopPropagation() }, h("b", {}, money(o.total)), actions));
}

function viewOrders(box) {
  const search = h("input", { type: "search", placeholder: "Search by order #, username or recipient" });
  const initial = new URLSearchParams(location.search).get("status");
  const status = h("select", {}, h("option", { value: "" }, "All statuses"),
    h("option", { value: "requests", selected: initial === "requests" }, "Needs review (cancel / return)"),
    STATUSES.map(s => h("option", { value: s, selected: s === initial }, label(s))));
  const list = h("div", { class: "list" });

  async function load() {
    const q = new URLSearchParams({ search: search.value.trim(), status: status.value });
    const rows = await api("GET", "/api/admin/orders?" + q);
    if (rows) list.replaceChildren(...(rows.length ? rows.map(o => orderCard(o, load)) : ["No orders found."]));
  }

  search.addEventListener("input", debounce(load));
  status.addEventListener("change", load);
  box.append(h("div", { class: "page-head" }, h("h1", {}, "Manage Orders")),
    h("div", { class: "toolbar" }, search, status), list);
  load();
}

async function viewOrder(box, id) {
  const render = async () => {
    const o = await api("GET", "/api/admin/orders/" + id);
    if (!o) return navigate("/admin/orders");
    const info = [
      ["Customer", o.user_id ? h("a", { href: "/admin/users/" + o.user_id, "data-nav": "" }, o.username) : "Deleted account"],
      ["Recipient", o.ship_name || "\u2014"],
      ["Mobile", o.ship_phone || "\u2014"],
      ["Address", o.ship_address || "\u2014"],
      ["Payment", o.payment_method === "COD" ? "Cash on delivery (COD)" : o.payment_method || "\u2014"],
      ["Placed", when(o.created_at)],
      ...(o.cancel_status ? [["Cancellation request", label(o.cancel_status) + (o.cancel_reason ? " \u2014 " + o.cancel_reason : "")]] : []),
      ...(o.return_requested_at ? [["Return request", label(o.return_status || "pending") + " \u2014 " + o.return_reason]] : [])
    ];
    box.replaceChildren(
      backLink("/admin/orders", "Back to orders"),
      h("div", { class: "page-head" },
        h("h1", {}, "Order #" + o.id), badge(o.status),
        o.status !== "cancelled" ? h("button", { class: "secondary-btn", onclick: () => printLabel(o) }, "Print QR label") : "",
        o.status === "pending" ? approveBtn(o, render) : "",
        ACTIVE.includes(o.status) ? cancelBtn(o, render) : "",
        requestButtons(o, render)),
      h("div", { class: "panel" }, h("dl", { class: "info-grid" },
        info.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))),
      h("h2", {}, "Items"),
      h("table", { class: "items" },
        h("thead", {}, h("tr", {}, ["Product", "Price", "Qty", "Subtotal"].map(t => h("th", {}, t)))),
        h("tbody", {}, o.items.map(i => h("tr", {},
          h("td", {}, i.name), h("td", {}, money(i.price)), h("td", {}, i.qty), h("td", {}, money(i.price * i.qty)))))),
      h("p", {}, h("b", {}, "Total: " + money(o.total))));
  };
  render();
}

// ---------- products ----------

function viewProducts(box) {
  const search = h("input", { type: "search", placeholder: "Search products" });
  const cat = h("select", {}, h("option", { value: "" }, "All categories"),
    CATEGORIES.map(c => h("option", { value: c }, label(c))));
  const list = h("div", { class: "list" });

  async function load() {
    const q = new URLSearchParams({ search: search.value.trim(), category: cat.value });
    const rows = await api("GET", "/api/products?" + q);
    if (rows) list.replaceChildren(...(rows.length ? rows.map(productRow) : ["No products found."]));
  }

  function productRow(p) {
    return h("div", { class: "row-card" },
      h("div", { class: "row-main" },
        p.image ? h("img", { class: "thumb", src: p.image, alt: "" }) : h("div", { class: "thumb" }),
        h("div", { class: "row-info" }, h("b", {}, p.name),
          h("small", {}, label(p.category) + " \u00b7 " + money(p.price) + " \u00b7 Stock: " + p.amount))),
      h("div", { class: "row-actions" },
        h("button", { class: "secondary-btn", onclick: () => productForm(box, p.id) }, "Edit"),
        h("button", {
          class: "danger-btn",
          onclick: async () => {
            if (!(await confirmAction(`Delete "${p.name}"? This can't be undone.`, "Delete"))) return;
            if (await api("DELETE", "/api/admin/products/" + p.id)) { toast("Product deleted.", "success"); load(); }
          }
        }, "Delete")));
  }

  search.addEventListener("input", debounce(load));
  cat.addEventListener("change", load);
  box.replaceChildren(
    h("div", { class: "page-head" }, h("h1", {}, "Manage Products"),
      h("button", { class: "primary-btn", onclick: () => productForm(box, null) }, "+ Add product")),
    h("div", { class: "toolbar" }, search, cat), list);
  load();
}

// One form for adding (id is null) and editing
async function productForm(box, id) {
  let p = { name: "", description: "", price: "", amount: "", category: "tops", images: [] };
  if (id) { p = await api("GET", "/api/admin/products/" + id); if (!p) return; }

  const name = h("input", { type: "text", value: p.name });
  const desc = h("textarea", {}, p.description);
  const price = h("input", { type: "number", min: "0", step: "0.01", value: p.price });
  const amount = h("input", { type: "number", min: "0", step: "1", value: p.amount });
  const cat = h("select", {}, CATEGORIES.map(c => h("option", { value: c, selected: c === p.category }, label(c))));
  const files = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: true });
  const field = (text, input) => h("label", { class: "field" }, text, input);

  const gallery = h("div", {}, p.images.map(img => {
    const item = h("div", { class: "img-item" },
      h("img", { class: "thumb", src: img.path, alt: "" }),
      h("button", {
        class: "secondary-btn",
        onclick: async () => { if (await api("DELETE", `/api/admin/products/${id}/images/${img.id}`)) item.remove(); }
      }, "Remove"));
    return item;
  }));

  async function save() {
    const body = { name: name.value, description: desc.value, price: price.value, amount: amount.value, category: cat.value };
    const saved = await api(id ? "PUT" : "POST", "/api/admin/products" + (id ? "/" + id : ""), body);
    if (!saved) return;
    if (files.files.length) {
      const fd = new FormData();
      [...files.files].forEach(f => fd.append("images", f));
      await api("POST", `/api/admin/products/${saved.id}/images`, fd); // shows its own error if it fails
    }
    toast("Product saved.", "success");
    viewProducts(box);
  }

  box.replaceChildren(
    h("div", { class: "page-head" }, h("h1", {}, id ? "Edit product" : "Add product")),
    h("div", { class: "form" },
      field("Name", name), field("Description", desc), field("Price (PHP)", price),
      field("Stock", amount), field("Category", cat),
      id ? h("div", {}, h("p", {}, h("b", {}, "Pictures")), gallery) : "",
      field(id ? "Add more pictures (JPG, PNG or WEBP, 5 MB max each)" : "Pictures (optional)", files),
      h("div", { class: "row-actions" },
        h("button", { class: "primary-btn", onclick: save }, "Save product"),
        h("button", { class: "secondary-btn", onclick: () => viewProducts(box) }, "Cancel"))));
}

// ---------- chats ----------

const chatState = c => !c.admin_id ? "Unclaimed" : c.mine ? "Claimed by you" : "Claimed by " + c.agent_name;
const chatBadge = c => h("span", {
  class: "badge " + (c.status === "closed" ? "cancelled" : !c.admin_id ? "pending" : c.mine ? "delivered" : "in_progress")
}, c.status === "closed" ? "Closed" : chatState(c));

// Runs fn every few seconds until `box` is no longer on the page
function poll(box, fn, ms = 3000) {
  const t = setInterval(() => {
    if (!box.isConnected) clearInterval(t);
    else if (!document.hidden) fn();
  }, ms);
}

function viewChats(box) {
  const status = h("select", {}, h("option", { value: "open" }, "Open chats"), h("option", { value: "closed" }, "Closed chats"));
  const list = h("div", { class: "list" });

  async function load() {
    const rows = await api("GET", "/api/admin/chats?status=" + status.value);
    if (rows) list.replaceChildren(...(rows.length ? rows.map(chatCard) : ["No chats here."]));
  }

  function chatCard(c) {
    const waiting = c.status === "open" && c.last_sender === "customer";
    return h("div", { class: "row-card clickable", onclick: () => navigate("/admin/chats/" + c.id) },
      h("div", { class: "row-info" },
        h("b", {}, c.customer_name || c.customer_username, " ", h("span", { class: "badge" }, c.topic_label)),
        h("small", {}, (waiting ? "Customer is waiting: " : "") + (c.last_body || "No messages yet").slice(0, 80)),
        h("small", {}, when(c.updated_at))),
      h("div", { class: "row-actions" }, chatBadge(c)));
  }

  status.addEventListener("change", load);
  box.append(h("div", { class: "page-head" }, h("h1", {}, "Chats")), h("div", { class: "toolbar" }, status), list);
  load();
  poll(box, load);
}

async function viewChat(box, id) {
  let last = 0, chat = null, chatKey = "";
  const log = h("div", { class: "chat-log" });
  const head = h("div", { class: "page-head" });
  const note = h("p", { class: "chat-note" });
  const input = h("input", { type: "text", maxlength: "1000", placeholder: "Type a message" });
  const compose = h("div", { class: "chat-compose" }, input, h("button", { class: "primary-btn", onclick: send }, "Send"));
  input.addEventListener("keydown", e => { if (e.key === "Enter") send(); });

  const act = (text, cls, path, ok) => h("button", {
    class: cls,
    onclick: async () => { if (await api("PUT", `/api/admin/chats/${id}/${path}`)) { toast(ok, "success"); refresh(); } }
  }, text);

  const closeBtn = h("button", {
    class: "danger-btn",
    onclick: async () => {
      if (!(await confirmAction("Close this chat? The customer will be told it has ended.", "Close chat", "Keep open"))) return;
      if (await api("PUT", `/api/admin/chats/${id}/close`)) { toast("Chat closed.", "success"); refresh(); }
    }
  }, "Close chat");

  function bubble(m) {
    if (m.sender === "system") return h("div", { class: "chat-system" }, m.body);
    return h("div", { class: "chat-msg " + (m.sender === "admin" ? "out" : "in") },
      h("small", {}, (m.sender === "admin" ? m.name : "Customer") + " \u00b7 " + when(m.created_at)),
      h("div", { class: "chat-bubble" }, m.body));
  }

  function drawHead() {
    const open = chat.status === "open";
    head.replaceChildren(
      h("h1", {}, (chat.customer_name || chat.customer_username) + " \u00b7 " + chat.topic_label),
      chatBadge(chat),
      ...(open && !chat.admin_id ? [act("Claim chat", "primary-btn", "claim", "You claimed this chat.")] : []),
      ...(open && chat.mine ? [act("Remove myself", "secondary-btn", "release", "You left this chat."), closeBtn] : []),
      h("a", { href: "/admin/users/" + chat.user_id, "data-nav": "" }, "View customer"));

    note.textContent = !open ? "This chat is closed."
      : !chat.admin_id ? "Claim this chat to reply. Other admins can read it, but can't reply while it's claimed."
      : !chat.mine ? chat.agent_name + " is handling this chat. Only they can reply until they remove themselves."
      : "";
    note.hidden = !note.textContent;
    compose.hidden = !(open && chat.mine);
  }

  async function refresh() {
    const d = await api("GET", `/api/admin/chats/${id}/messages?after=${last}`);
    if (!box.isConnected) return;
    if (!d) return navigate("/admin/chats");
    const key = [d.chat.status, d.chat.admin_id].join();
    chat = d.chat;
    if (key !== chatKey) { chatKey = key; drawHead(); }
    d.messages.forEach(m => { if (m.id <= last) return; last = m.id; log.append(bubble(m)); });
    if (d.messages.length) log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    if (await api("POST", `/api/admin/chats/${id}/messages`, { body })) refresh();
    else input.value = body;
  }

  box.append(backLink("/admin/chats", "Back to chats"), head, log, note, compose);
  await refresh();
  poll(box, refresh);
}

// ---------- logs + QR label ----------

function viewLogs(box) {
  const type = h("select", {}, h("option", { value: "" }, "All activity"),
    h("option", { value: "order" }, "Order updates"), h("option", { value: "stock" }, "Stock changes"));
  const search = h("input", { type: "search", placeholder: "Search by person, order # or product" });
  const list = h("div", { class: "list" });

  async function load() {
    const q = new URLSearchParams({ type: type.value, search: search.value.trim() });
    const rows = await api("GET", "/api/admin/logs?" + q);
    if (rows) list.replaceChildren(...(rows.length ? rows.map(logRow) : ["No activity yet."]));
  }

  function logRow(l) {
    return h("div", { class: "row-card" },
      h("div", { class: "row-info" },
        h("b", {}, l.summary),
        h("small", {}, l.actor + " (" + l.role + ")" + (l.method ? " \u00b7 " + l.method : "") + " \u00b7 " + when(l.created_at))),
      l.order_id ? h("a", { href: "/admin/orders/" + l.order_id, "data-nav": "" }, "Order #" + l.order_id) : "");
  }

  search.addEventListener("input", debounce(load));
  type.addEventListener("change", load);
  box.append(h("div", { class: "page-head" }, h("h1", {}, "Logs")), h("div", { class: "toolbar" }, search, type), list);
  load();
  poll(box, load, 5000);
}

// Opens a printable parcel label with the order's QR code
async function printLabel(o) {
  const w = window.open("", "_blank"); // open first so pop-up blockers allow it
  if (!w) return toast("Allow pop-ups to print the label.", "error");
  const d = await api("GET", `/api/admin/orders/${o.id}/qr`);
  if (!d) return w.close();
  const doc = w.document;
  doc.title = "Order #" + o.id;
  const css = doc.createElement("style");
  css.textContent = "body{font-family:system-ui,sans-serif;margin:16px}.label{width:340px;padding:16px;border:2px solid #000;text-align:center}.label svg{width:240px;height:240px}.label h1{margin:6px 0}.label p{margin:4px 0}";
  doc.head.append(css);
  const label = doc.createElement("div");
  label.className = "label";
  label.innerHTML = d.svg; // SVG generated by our own server
  const line = text => { const p = doc.createElement("p"); p.textContent = text; return p; };
  const title = doc.createElement("h1");
  title.textContent = "Order #" + o.id;
  label.append(title, line(o.ship_name || ""), line(o.ship_phone || ""), line(o.ship_address || ""),
    line(o.items.map(i => i.qty + " \u00d7 " + i.name).join(", ")));
  doc.body.append(label);
  setTimeout(() => w.print(), 300);
}

// ---------- start ----------

fetch("/api/me").then(r => r.ok ? r.json() : null).then(u => {
  if (!u || u.role !== "admin") { location.href = "/"; return; }
  me = u;
  route();
});