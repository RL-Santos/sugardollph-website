const main = document.getElementById("main");

// ---------- helpers (same ones admin.js uses) ----------

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

const when = s => new Date(s.replace(" ", "T") + "Z").toLocaleString();
const label = s => { const t = String(s).replace("_", " "); return t[0].toUpperCase() + t.slice(1); };
const badge = status => h("span", { class: "badge " + status }, label(status));
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

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

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) { location.href = "/"; return null; }
  if (!res.ok) { toast(data.error || "Something went wrong.", "error"); return null; }
  return data;
}

// Runs fn every few seconds until `box` is no longer on the page
function poll(box, fn, ms = 3000) {
  const t = setInterval(() => {
    if (!box.isConnected) clearInterval(t);
    else if (!document.hidden) fn();
  }, ms);
}

// ---------- sidebar ----------

const KEY = "warehouseSidebarCollapsed";
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
  [/^\/warehouse\/?$/, viewScanner],
  [/^\/warehouse\/orders\/?$/, viewOrders],
  [/^\/warehouse\/stock\/?$/, viewStock],
  [/^\/warehouse\/activity\/?$/, viewActivity]
];

function route() {
  stopScanner(); // the camera only runs on the Scanner page
  const p = location.pathname;
  document.querySelectorAll("#sidebar nav a").forEach(a => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === "/warehouse" ? /^\/warehouse\/?$/.test(p) : p.startsWith(href));
  });
  for (const [re, view] of routes) {
    if (re.test(p)) {
      const box = h("div");
      main.replaceChildren(box);
      view(box);
      return;
    }
  }
  navigate("/warehouse");
}

// ---------- scanner ----------

const MODES = [["packed", "Pack"], ["shipped", "Ship"], ["delivered", "Delivered"], ["returned", "Returned"]];
let scanMode = "packed";
let scanner = null;

async function stopScanner() {
  const s = scanner;
  scanner = null;
  if (s) { try { await s.stop(); s.clear(); } catch {} }
}

function viewScanner(box) {
  const modeBtns = MODES.map(([key, text]) => h("button", {
    class: "mode-btn" + (key === scanMode ? " active" : ""),
    onclick: e => {
      scanMode = key;
      modeBtns.forEach(b => b.classList.toggle("active", b === e.currentTarget));
    }
  }, text));
  const reader = h("div", { id: "reader" });
  const camMsg = h("p", { class: "chat-note" });
  const result = h("div", { class: "scan-result" });

  box.append(
    h("div", { class: "page-head" }, h("h1", {}, "Scanner")),
    h("p", { class: "chat-note" }, "Pick what you're doing, then point the camera at the QR label on the parcel."),
    h("div", { class: "mode-bar" }, modeBtns), reader, camMsg, result);

  function showResult(d) {
    navigator.vibrate?.(d.ok ? 80 : [120, 60, 120]);
    result.className = "scan-result " + (d.ok ? "ok" : d.kind);
    result.replaceChildren(
      h("h2", {}, d.message),
      d.by ? h("p", {}, "Scanned by " + d.by) : "",
      d.order && d.order.recipient ? h("p", {}, "For: " + d.order.recipient) : "",
      d.order ? h("ul", {}, d.order.items.map(i => h("li", {}, i.qty + " \u00d7 " + i.name))) : "");
  }

  let busy = false, lastText = "", lastAt = 0;
  async function onScan(text) {
    if (busy || (text === lastText && Date.now() - lastAt < 4000)) return; // ignore repeat reads of the same label
    busy = true;
    lastText = text;
    const d = await api("POST", "/api/warehouse/scan", { code: text, status: scanMode });
    if (d) showResult(d);
    lastAt = Date.now();
    busy = false;
  }

  if (typeof Html5Qrcode === "undefined") {
    camMsg.textContent = "The scanner library didn't load. Check your internet connection and refresh.";
    return;
  }
  const s = new Html5Qrcode("reader");
  scanner = s;
  s.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: (vw, vh) => { const side = Math.floor(Math.min(vw, vh) * 0.7); return { width: side, height: side }; } },
    onScan, () => {}
  ).catch(() => {
    camMsg.textContent = "Can't open the camera. Allow camera access in your browser and use the https:// link. You can still use the Orders page.";
  });
}

// ---------- orders queue ----------

const TABS = [["in_progress", "To pack"], ["packed", "To ship"], ["shipped", "Out for delivery"], ["returning", "Returns incoming"]];
const NEXT = {
  in_progress: ["packed", "Mark packed"],
  packed: ["shipped", "Mark shipped"],
  shipped: ["delivered", "Mark delivered"],
  returning: ["returned", "Mark returned"]
};

function viewOrders(box) {
  const search = h("input", { type: "search", placeholder: "Search by order # or recipient" });
  const tab = h("select", {}, TABS.map(([v, t]) => h("option", { value: v }, t)));
  const list = h("div", { class: "list" });

  async function load() {
    const t = tab.value;
    const q = new URLSearchParams({ status: t, search: search.value.trim() });
    const rows = await api("GET", "/api/warehouse/orders?" + q);
    if (rows) list.replaceChildren(...(rows.length ? rows.map(o => card(o, t)) : ["Nothing here."]));
  }

  async function move(o, status) {
    if (status === "returned" &&
        !(await confirmAction("Mark order #" + o.id + " as returned? Its items go back into stock.", "Mark returned"))) return;
    const r = await api("PUT", `/api/warehouse/orders/${o.id}/status`, { status });
    if (r) toast(r.message, r.ok ? "success" : "error");
    load();
  }

  function card(o, t) {
    const [next, text] = NEXT[t];
    return h("div", { class: "row-card" },
      h("div", { class: "row-info" },
        h("b", {}, "Order #" + o.id, " ", t === "returning" ? h("span", { class: "badge pending" }, "Return requested") : badge(o.status)),
        h("small", {}, "For: " + (o.recipient || "\u2014")),
        h("small", {}, o.items.map(i => i.qty + " \u00d7 " + i.name).join(", ")),
        o.return_reason ? h("small", {}, "Reason: " + o.return_reason) : ""),
      h("div", { class: "row-actions" }, h("button", { class: "primary-btn", onclick: () => move(o, next) }, text)));
  }

  search.addEventListener("input", debounce(load));
  tab.addEventListener("change", load);
  box.append(h("div", { class: "page-head" }, h("h1", {}, "Orders")), h("div", { class: "toolbar" }, search, tab), list);
  load();
  poll(box, load, 5000);
}

// ---------- stock ----------

function viewStock(box) {
  const search = h("input", { type: "search", placeholder: "Search products" });
  const filter = h("select", {}, h("option", { value: "" }, "All products"), h("option", { value: "low" }, "Low stock (5 or fewer)"));
  const list = h("div", { class: "list" });

  async function load() {
    let rows = await api("GET", "/api/products?search=" + encodeURIComponent(search.value.trim()));
    if (!rows) return;
    if (filter.value === "low") rows = rows.filter(p => p.amount <= 5);
    list.replaceChildren(...(rows.length ? rows.map(row) : ["No products found."]));
  }

  function row(p) {
    const qty = h("input", { type: "number", min: "0", step: "1", placeholder: "Qty", class: "qty-input" });
    const note = h("input", { type: "text", maxlength: "60", placeholder: "Note (optional)" });
    const apply = async mode => {
      const n = Number(qty.value);
      if (qty.value === "" || !Number.isInteger(n)) return toast("Enter a whole number.", "error");
      if (mode === "set" && !(await confirmAction(`Set "${p.name}" to ${n}? It shows ${p.amount} now.`, "Set count"))) return;
      if (await api("PUT", "/api/warehouse/stock/" + p.id, { mode, qty: n, reason: note.value })) {
        toast("Stock updated.", "success");
        load();
      }
    };
    return h("div", { class: "row-card" },
      h("div", { class: "row-main" },
        p.image ? h("img", { class: "thumb", src: p.image, alt: "" }) : h("div", { class: "thumb" }),
        h("div", { class: "row-info" }, h("b", {}, p.name),
          h("small", {}, "Stock: " + p.amount + (p.amount <= 5 ? " \u00b7 LOW" : "")))),
      h("div", { class: "row-actions" }, qty, note,
        h("button", { class: "primary-btn", onclick: () => apply("add") }, "Add stock"),
        h("button", { class: "secondary-btn", onclick: () => apply("set") }, "Set count")));
  }

  search.addEventListener("input", debounce(load));
  filter.addEventListener("change", load);
  box.append(h("div", { class: "page-head" }, h("h1", {}, "Stock")),
    h("p", { class: "chat-note" }, "\"Add stock\" adds to the current count (incoming delivery). \"Set count\" replaces it (recount, damaged, lost)."),
    h("div", { class: "toolbar" }, search, filter), list);
  load();
}

// ---------- my activity ----------

async function viewActivity(box) {
  const rows = await api("GET", "/api/warehouse/activity");
  if (!rows) return;
  box.append(h("div", { class: "page-head" }, h("h1", {}, "My activity")),
    h("div", { class: "list" }, rows.length ? rows.map(l => h("div", { class: "row-card" },
      h("div", { class: "row-info" },
        h("b", {}, l.summary),
        h("small", {}, when(l.created_at) + (l.method ? " \u00b7 " + l.method : ""))))) : "Nothing yet."));
}

// ---------- start ----------

fetch("/api/me").then(r => r.ok ? r.json() : null).then(u => {
  if (!u || u.role !== "warehouse") { location.href = "/"; return; }
  route();
});