// ---------- NOTIFICATIONS ----------

const bellWrap = document.getElementById("bell-wrap");
const bellBtn = document.getElementById("bell-btn");
const bellCount = document.getElementById("bell-count");
const notifPanel = document.getElementById("notif-panel");
let notifTimer = null;
let notifItems = [];
let notifLastId = null; // newest id seen, so we only toast new arrivals

function notifAgo(s) {
  const t = new Date(s.replace(" ", "T") + "Z");
  const secs = Math.max(0, (Date.now() - t) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return Math.floor(secs / 60) + " min ago";
  if (secs < 86400) return Math.floor(secs / 3600) + " hr ago";
  return t.toLocaleDateString();
}

function notifOpen(link) {
  if (link.startsWith("chat:")) openChatById(Number(link.slice(5)));
  else navigate(link);
}

function notifPut(url) {
  return fetch(url, { method: "PUT" }).then(notifLoad);
}

function notifDraw() {
  const top = notifPanel.scrollTop;
  const head = document.createElement("div");
  head.className = "notif-head";
  const title = document.createElement("b");
  title.textContent = "Notifications";
  const markAll = document.createElement("button");
  markAll.className = "link-btn";
  markAll.textContent = "Mark all as read";
  markAll.onclick = () => notifPut("/api/notifications/read");
  head.append(title, markAll);

  const rows = notifItems.map(n => {
    const b = document.createElement("button");
    b.className = "notif-item" + (n.is_read ? "" : " unread");
    const t = document.createElement("b");
    t.textContent = n.title;
    const body = document.createElement("span");
    body.textContent = n.body;
    const time = document.createElement("small");
    time.textContent = notifAgo(n.created_at);
    b.append(t, body, time);
    b.onclick = () => {
      notifPanel.hidden = true;
      notifPut("/api/notifications/" + n.id + "/read");
      if (n.link) notifOpen(n.link);
    };
    return b;
  });
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "notif-empty";
    empty.textContent = "No notifications yet.";
    rows.push(empty);
  }
  notifPanel.replaceChildren(head, ...rows);
  notifPanel.scrollTop = top;
}

async function notifLoad() {
  const res = await fetch("/api/notifications").catch(() => null);
  if (!res || !res.ok) return;
  const d = await res.json();
  notifItems = d.items;

  bellCount.textContent = d.unread > 99 ? "99+" : d.unread;
  bellCount.hidden = d.unread === 0;

  const newest = d.items.length ? d.items[0].id : 0;
  if (notifLastId !== null) {
    const fresh = d.items.filter(n => n.id > notifLastId && !n.is_read);
    if (fresh.length) {
      const say = typeof showToast === "function" ? showToast : toast;
      say(fresh.length === 1 ? fresh[0].body : fresh.length + " new notifications");
    }
  }
  notifLastId = newest;
  if (!notifPanel.hidden) notifDraw();
}

// on = true shows the bell and starts polling; false hides it and stops
function notifUserChanged(on) {
  clearInterval(notifTimer);
  notifPanel.hidden = true;
  bellWrap.hidden = !on;
  notifLastId = null;
  if (!on) return;
  notifLoad();
  notifTimer = setInterval(() => { if (!document.hidden) notifLoad(); }, 10000);
}

bellBtn.addEventListener("click", () => {
  notifPanel.hidden = !notifPanel.hidden;
  if (!notifPanel.hidden) { notifDraw(); notifLoad(); }
});
document.addEventListener("click", e => {
  if (!notifPanel.hidden && !bellWrap.contains(e.target)) notifPanel.hidden = true;
});

// The admin page is only reachable by logged-in admins, so it starts right away
if (document.body.classList.contains("admin")) notifUserChanged(true);