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

function table(cols, rows, empty) {
  if (!rows.length) return h("p", { class: "empty" }, empty);
  return h("div", { class: "table-wrap" },
    h("table", { class: "data" },
      h("thead", {}, h("tr", {}, cols.map(c => h("th", {}, c)))),
      h("tbody", {}, rows)));
}
const tr = (onclick, ...cells) => h("tr", onclick ? { class: "clickable", onclick } : {},
  cells.map(c => c instanceof Node && c.tagName === "TD" ? c : h("td", {}, c)));
const actionsCell = kids => h("td", { class: "actions", onclick: e => e.stopPropagation() }, kids);

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
  [/^\/admin\/discounts\/?$/, viewDiscounts],
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

const STATUS_COLOR = { pending: "#CBAD8D", in_progress: "#A57756", paid: "#C9A792", packed: "#A48374",
  shipped: "#988780", delivered: "#3A2D28", cancelled: "#b00020", returned: "#D1C7BD" };

function barChart(days) {
  const max = Math.max(1, ...days.map(d => d.revenue));
  return h("div", { class: "bars" }, days.map(d =>
    h("div", { class: "bar-col", title: money(d.revenue) + " \u00b7 " + d.orders + " order(s)" },
      h("small", {}, d.revenue ? Math.round(d.revenue) : ""),
      h("div", { class: "bar-area" },
        h("div", { class: "bar", style: `height:${d.revenue ? Math.max(d.revenue / max * 100, 4) : 1}%` })),
      h("small", {}, d.label))));
}

function donut(counts) {
  const entries = Object.entries(counts);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  let acc = 0;
  const stops = entries.map(([s, n]) => {
    const from = acc / total * 100; acc += n;
    return `${STATUS_COLOR[s] || "#999"} ${from}% ${acc / total * 100}%`;
  });
  return h("div", { class: "donut-wrap" },
    h("div", { class: "donut", style: `background:${total ? `conic-gradient(${stops.join(",")})` : "#eee"}` },
      h("div", { class: "donut-hole" }, h("b", {}, total), h("small", {}, "orders"))),
    h("div", { class: "legend" }, entries.map(([s, n]) =>
      h("span", {}, h("i", { style: `background:${STATUS_COLOR[s] || "#999"}` }), label(s) + " (" + n + ")"))));
}

function hbars(rows, name, value, text, cls) {
  const max = Math.max(1, ...rows.map(value));
  return rows.map(r => h("div", { class: "hbar" },
    h("div", { class: "hbar-top" }, h("span", {}, name(r)), h("b", {}, text(r))),
    h("div", { class: "hbar-track" }, h("span", { class: cls || "", style: `width:${value(r) / max * 100}%` }))));
}

async function viewOverview(box) {
  const d = await api("GET", "/api/admin/overview");
  if (!d) return;
  const c = d.counts;
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const stat = (name, value, href, tone) =>
    h(href ? "a" : "div", { class: "stat " + (tone || ""), href, "data-nav": href ? "" : null },
      h("span", {}, name), h("b", {}, value));
  const empty = text => h("p", { class: "empty" }, text);

  // last 7 days, Manila time
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() + 8 * 3600e3 - i * 864e5).toISOString().slice(0, 10);
    const f = d.daily.find(x => x.day === day) || { orders: 0, revenue: 0 };
    days.push({ ...f, label: new Date(day + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }) });
  }

  box.append(
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Dashboard"),
      h("small", { class: "sub" }, new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })))),
    h("div", { class: "stats" },
      stat("Requests to review", d.requests, "/admin/orders?status=requests", d.requests ? "warn" : ""),
      stat("Pending approval", c.pending || 0, "/admin/orders?status=pending", c.pending ? "warn" : ""),
      stat("In progress", c.in_progress || 0, "/admin/orders?status=in_progress"),
      stat("Daily revenue", money(days[days.length - 1].revenue), null, "good"),
      stat("Total orders", total, "/admin/orders"),
      stat("Customers", d.customers, "/admin/users"),
      stat("Products", d.products, "/admin/products")),
    h("div", { class: "panels wide" },
      h("div", { class: "panel span2" }, h("h2", {}, "Revenue \u00b7 last 7 days"), barChart(days)),
      h("div", { class: "panel" }, h("h2", {}, "Orders by status"), donut(c))),
    h("div", { class: "panels" },
      h("div", { class: "panel" }, h("h2", {}, "Trending products"),
        ...(d.trending.length ? hbars(d.trending, t => t.name, t => t.sold, t => t.sold + " sold") : [empty("No sales yet.")])),
      h("div", { class: "panel" }, h("h2", {}, "Low stock (5 or fewer)"),
        ...(d.lowStock.length ? hbars(d.lowStock, p => p.name, p => p.amount, p => p.amount + " left", "warn") : [empty("Nothing is running low.")])),
      h("div", { class: "panel span-all" }, h("h2", {}, "Recent orders"),
        table(["Order", "Customer", "Total", "Status"],
          d.recent.map(o => tr(() => navigate("/admin/orders/" + o.id), h("b", {}, "#" + o.id), o.customer, money(o.total), badge(o.status))),
          "No orders yet."))));
}

// ---------- users ----------

function viewUsers(box) {
  const search = h("input", { type: "search", placeholder: "Search by username, name or email" });
  const list = h("div");

  async function load() {
    const rows = await api("GET", "/api/admin/users?search=" + encodeURIComponent(search.value.trim()));
    if (rows) list.replaceChildren(table(["Username", "Name", "Email", "Role", "Status", "Orders", "Actions"],
      rows.map(userRow), "No users found."));
  }

  function userRow(u) {
    const name = [u.first_name, u.last_name].filter(Boolean).join(" ");
    let actions = [h("small", {}, "(you)")];
    if (!(me && u.username === me.username)) {
      const roleSel = h("select", {}, ROLES.map(r => h("option", { value: r, selected: r === u.role }, r)));
      actions = [
        roleSel,
        h("button", { class: "secondary-btn", onclick: async () => {
          if (await api("PUT", `/api/admin/users/${u.id}/role`, { role: roleSel.value })) {
            toast(u.username + " is now " + roleSel.value + ".", "success"); load();
          }
        } }, "Change role"),
        h("button", { class: u.active ? "danger-btn" : "secondary-btn", onclick: async () => {
          if (u.active && !(await confirmAction(`Deactivate ${u.username}? They won't be able to log in.`, "Deactivate"))) return;
          if (await api("PUT", `/api/admin/users/${u.id}/active`, { active: !u.active })) {
            toast(u.username + (u.active ? " was deactivated." : " was activated."), "success"); load();
          }
        } }, u.active ? "Deactivate" : "Activate")
      ];
    }
    return tr(() => navigate("/admin/users/" + u.id),
      h("b", {}, u.username), name || "\u2014", u.email || "\u2014",
      h("span", { class: "badge" }, u.role),
      h("span", { class: "badge " + (u.active ? "delivered" : "cancelled") }, u.active ? "Active" : "Deactivated"),
      u.orders, actionsCell(actions));
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
    ordersTable(u.orders));
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

// Shows the reason when a customer asks to cancel or return an order
function reasonCell(o) {
  const row = (kind, status, reason) => h("div", { class: "reason" },
    h("small", {}, kind + " \u00b7 " + label(status)),
    h("span", {}, reason || "No reason given"));
  const parts = [];
  if (o.cancel_status) parts.push(row("Cancellation", o.cancel_status, o.cancel_reason));
  if (o.return_requested_at) parts.push(row("Return", o.return_status || "pending", o.return_reason));
  return h("td", { class: "reason-col" }, parts.length ? parts : "\u2014");
}

function ordersTable(orders, reload) {
  const cols = ["Order", "Customer", "Items", "Placed", "Total", "Status", "Reason"];
  if (reload) cols.push("Actions");
  return table(cols, orders.map(o => {
    const cells = [
      h("b", {}, "#" + o.id),
      o.username || o.ship_name || "Deleted account",
      o.items.map(i => i.name + " \u00d7" + i.qty).join(", "),
      when(o.created_at), money(o.total),
      h("td", { class: "status-col" }, badge(o.status)),
      reasonCell(o)
    ];
    if (reload) {
      const actions = [];
      const cancelling = o.cancel_status === "pending";
      if (o.status === "pending" && !cancelling) actions.push(approveBtn(o, reload));
      if (ACTIVE.includes(o.status) && !cancelling) actions.push(cancelBtn(o, reload));
      actions.push(...requestButtons(o, reload));
      cells.push(actionsCell(actions));
    }
    return tr(() => navigate("/admin/orders/" + o.id), ...cells);
  }), "No orders found.");
}

function viewOrders(box) {
  const search = h("input", { type: "search", placeholder: "Search by order #, username or recipient" });
  const initial = new URLSearchParams(location.search).get("status");
  const status = h("select", {}, h("option", { value: "" }, "All statuses"),
    h("option", { value: "requests", selected: initial === "requests" }, "Needs review (cancel / return)"),
    STATUSES.map(s => h("option", { value: s, selected: s === initial }, label(s))));
  const list = h("div");

  async function load() {
    const q = new URLSearchParams({ search: search.value.trim(), status: status.value });
    const rows = await api("GET", "/api/admin/orders?" + q);
    if (rows) list.replaceChildren(ordersTable(rows, load));
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
      ["Payment", o.payment_method === "COD" ? "Cash on delivery (COD)" : o.payment_detail || o.payment_method || "\u2014"],
      ...(o.discount_amount > 0 ? [["Discount", o.discount_code + " (-" + money(o.discount_amount) + ")"]] : []),
      ["Placed", when(o.created_at)],
      ...(o.cancel_status ? [["Cancellation request", label(o.cancel_status) + (o.cancel_reason ? " \u2014 " + o.cancel_reason : "")]] : []),
      ...(o.return_requested_at ? [["Return request", label(o.return_status || "pending") + " \u2014 " + o.return_reason]] : []),
      ...(o.return_requested_at && o.payment_method !== "COD" ? [["Payment proof", o.payment_proof
        ? h("a", { href: "/api/admin/orders/" + o.id + "/proof", target: "_blank" }, "View picture")
        : "Not uploaded"]] : [])
    ];
    box.replaceChildren(
      backLink("/admin/orders", "Back to orders"),
      h("div", { class: "page-head" },
        h("h1", {}, "Order #" + o.id), badge(o.status),
        o.status !== "cancelled" ? h("button", { class: "secondary-btn", onclick: () => printLabel(o) }, "Print QR label") : "",
        o.status === "pending" && o.cancel_status !== "pending" ? approveBtn(o, render) : "",
        ACTIVE.includes(o.status) && o.cancel_status !== "pending" ? cancelBtn(o, render) : "",
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
  const list = h("div");

  async function load() {
    const q = new URLSearchParams({ search: search.value.trim(), category: cat.value });
    const rows = await api("GET", "/api/products?" + q);
    if (rows) list.replaceChildren(table(["", "Product", "Category", "Price", "Stock", "Actions"],
      rows.map(productRow), "No products found."));
  }

  function productRow(p) {
    const low = p.amount <= 5;
    return tr(null,
      p.image ? h("img", { class: "thumb", src: p.image, alt: "" }) : h("div", { class: "thumb" }),
      h("b", {}, p.name),
      h("span", { class: "badge" }, label(p.category)),
      money(p.price),
      p.amount + (low ? " \u00b7 LOW" : ""),
      actionsCell([
        h("button", { class: "secondary-btn", onclick: () => productForm(box, p.id) }, "Edit"),
        h("button", { class: "danger-btn", onclick: async () => {
          if (!(await confirmAction(`Delete "${p.name}"? This can't be undone.`, "Delete"))) return;
          if (await api("DELETE", "/api/admin/products/" + p.id)) { toast("Product deleted.", "success"); load(); }
        } }, "Delete")]));
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

// ---------- discounts ----------

function viewDiscounts(box) {
  const list = h("div");
  const code = h("input", { type: "text", maxlength: "20", placeholder: "e.g. SUMMER10" });
  const type = h("select", {}, h("option", { value: "percent" }, "Percent (%)"), h("option", { value: "fixed" }, "Fixed amount (PHP)"));
  const value = h("input", { type: "number", min: "0", step: "0.01", placeholder: "10" });
  const min = h("input", { type: "number", min: "0", step: "0.01", placeholder: "Optional" });
  const uses = h("input", { type: "number", min: "1", step: "1", placeholder: "Optional" });
  const expires = h("input", { type: "date" });
  const field = (text, input) => h("label", { class: "field" }, text, input);

  async function create() {
    const body = { code: code.value, type: type.value, value: value.value, min_spend: min.value,
      max_uses: uses.value, expires_on: expires.value };
    if (!(await api("POST", "/api/admin/discounts", body))) return;
    toast("Discount code created.", "success");
    [code, value, min, uses, expires].forEach(i => { i.value = ""; });
    load();
  }

  async function load() {
    const rows = await api("GET", "/api/admin/discounts");
    if (rows) list.replaceChildren(table(["Code", "Discount", "Min. spend", "Used", "Expires", "Status", "Actions"],
      rows.map(row), "No discount codes yet."));
  }

  function row(d) {
    const todayStr = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // Manila date
    const state = !d.active ? ["Inactive", "shipped"]
      : d.expires_on && d.expires_on < todayStr ? ["Expired", "shipped"]
      : d.max_uses != null && d.used >= d.max_uses ? ["Used up", "shipped"]
      : ["Active", "delivered"];
    return tr(null,
      h("b", {}, d.code),
      d.type === "percent" ? d.value + "% off" : money(d.value) + " off",
      d.min_spend ? money(d.min_spend) : "\u2014",
      d.used + (d.max_uses != null ? " / " + d.max_uses : ""),
      d.expires_on || "No expiry",
      h("span", { class: "badge " + state[1] }, state[0]),
      actionsCell([
        h("button", { class: "secondary-btn", onclick: async () => {
          if (await api("PUT", `/api/admin/discounts/${d.id}/active`, { active: !d.active })) load();
        } }, d.active ? "Deactivate" : "Activate"),
        h("button", { class: "danger-btn", onclick: async () => {
          if (!(await confirmAction(`Delete code ${d.code}?`, "Delete"))) return;
          if (await api("DELETE", "/api/admin/discounts/" + d.id)) { toast("Code deleted.", "success"); load(); }
        } }, "Delete")]));
  }

  box.append(
    h("div", { class: "page-head" }, h("h1", {}, "Discount codes")),
    h("div", { class: "panel form" }, h("h2", {}, "Create a code"),
      field("Code", code), field("Type", type), field("Value", value),
      field("Minimum spend (PHP)", min), field("Max uses", uses), field("Expires on", expires),
      h("button", { class: "primary-btn", onclick: create }, "Create code")),
    h("h2", {}, "Codes"), list);
  load();
}

// ---------- logs + QR label ----------

function viewLogs(box) {
  const type = h("select", {}, h("option", { value: "" }, "All activity"),
    h("option", { value: "order" }, "Order updates"), h("option", { value: "stock" }, "Stock changes"),
    h("option", { value: "product" }, "Product edits"), h("option", { value: "user" }, "User edits"));
  const search = h("input", { type: "search", placeholder: "Search by person, order # or product" });
  const list = h("div");

  async function load() {
    const q = new URLSearchParams({ type: type.value, search: search.value.trim() });
    const rows = await api("GET", "/api/admin/logs?" + q);
    if (rows) list.replaceChildren(table(["Time", "Who", "Role", "Type", "Activity", "Order"],
      rows.map(l => tr(null, when(l.created_at), h("b", {}, l.actor), l.role,
        h("span", { class: "badge " + l.type }, label(l.type)),
        l.summary + (l.method ? " (" + l.method + ")" : ""),
        l.order_id ? h("a", { href: "/admin/orders/" + l.order_id, "data-nav": "" }, "#" + l.order_id) : "")),
      "No activity yet."));
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