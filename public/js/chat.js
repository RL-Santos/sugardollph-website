// ---------- CUSTOMER SERVICE CHAT ----------

const chatPanel = document.getElementById("chat-panel");
const chatBody = document.getElementById("chat-body");
const chatTitle = document.getElementById("chat-title");
const chatBack = document.getElementById("chat-back");
let chatTimer = null;
let chatToken = 0; // bumps on every screen change so slow, older responses are ignored
let chatStarting = false;

const chatGet = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
const chatState = c => c.status === "closed" ? "Closed" : c.agent_name ? "With " + c.agent_name : "Waiting for an agent";

function stopChatPoll() { clearInterval(chatTimer); chatTimer = null; }
function startChatPoll(fn) {
  stopChatPoll();
  chatTimer = setInterval(() => { if (!document.hidden) fn(); }, 3000);
}

function hideChat() { chatPanel.hidden = true; stopChatPoll(); chatToken++; }

function chatUserChanged() {
  const ok = !!currentUser && currentUser.role === "customer";
  document.getElementById("chat-fab").hidden = !ok;
  if (!ok) hideChat();
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ----- screen 1: my chats -----
async function showChatList() {
  const token = ++chatToken;
  chatTitle.textContent = "Customer service";
  chatBack.hidden = true;

  const render = async () => {
    const chats = await chatGet("/api/chats");
    if (!chats || token !== chatToken) return;
    if (chats.length === 0) { showTopicPicker(false); return; }
    chatBody.replaceChildren(...chats.map(c => {
      const item = el("button", "chat-item");
      item.append(el("b", "", c.topic_label), el("small", "", chatState(c)), el("small", "", (c.last_body || "").slice(0, 60)));
      item.onclick = () => showChat(c.id);
      return item;
    }), makeButton("+ New chat", () => showTopicPicker(true)));
  };
  await render();
  startChatPoll(render);
}

// ----- screen 2: pick a concern -----
async function showTopicPicker(canGoBack) {
  const token = ++chatToken;
  stopChatPoll();
  chatTitle.textContent = "What do you need help with?";
  chatBack.hidden = !canGoBack;
  chatBack.onclick = showChatList;
  const topics = await chatGet("/api/chat/topics");
  if (!topics || token !== chatToken) return;

  chatBody.replaceChildren(...topics.map(t => {
    const b = el("button", "chat-topic", t.label);
    b.onclick = () => t.key === "other" ? showOtherForm(canGoBack) : startChat(t.key, "");
    return b;
  }));
}

// The special option: the customer describes a concern that isn't in the list
function showOtherForm(canGoBack) {
  chatTitle.textContent = "Something else";
  chatBack.hidden = false;
  chatBack.onclick = () => showTopicPicker(canGoBack);
  const text = el("textarea", "chat-text");
  text.maxLength = 1000;
  text.placeholder = "Tell us what you need help with";
  chatBody.replaceChildren(
    el("p", "chat-note", "Your concern isn't in the list? Describe it and an agent will pick it up."),
    text,
    makeButton("Start chat", () => startChat("other", text.value))
  );
  text.focus();
}

async function startChat(topic, message) {
  if (chatStarting) return;
  chatStarting = true;
  try {
    const data = await send("POST", "/api/chats", { topic, message });
    if (data) showChat(data.id);
  } finally { chatStarting = false; }
}

// ----- screen 3: one chat -----
async function showChat(id) {
  const token = ++chatToken;
  let last = 0;
  chatBack.hidden = false;
  chatBack.onclick = showChatList;

  const status = el("span");
  const endBtn = el("button", "link-btn", "End chat");
  const bar = el("div", "chat-status");
  bar.append(status, endBtn);
  const log = el("div", "chat-log");
  const input = el("input");
  input.maxLength = 1000;
  input.placeholder = "Type a message";
  const form = el("div", "chat-compose");
  form.append(input, makeButton("Send", submit));
  chatBody.replaceChildren(bar, log, form);

  function bubble(m) {
    if (m.sender === "system") return el("div", "chat-system", m.body);
    const row = el("div", "chat-msg " + (m.sender === "customer" ? "out" : "in"));
    row.append(el("small", "", m.sender === "customer" ? "You" : m.name), el("div", "chat-bubble", m.body));
    return row;
  }

  async function refresh() {
    const d = await chatGet("/api/chats/" + id + "/messages?after=" + last);
    if (!d || token !== chatToken) return;
    const closed = d.chat.status === "closed";
    chatTitle.textContent = d.chat.topic_label;
    status.textContent = closed ? "This chat has ended." : d.chat.agent_name
      ? "You're chatting with " + d.chat.agent_name : "Waiting for an agent to join...";
    endBtn.hidden = closed;
    form.hidden = closed;
    d.messages.forEach(m => { if (m.id <= last) return; last = m.id; log.append(bubble(m)); });
    if (d.messages.length) log.scrollTop = log.scrollHeight;
  }

  async function submit() {
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    if (await send("POST", "/api/chats/" + id + "/messages", { body })) refresh();
    else input.value = body;
  }

  input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
  endBtn.onclick = async () => {
    if (!(await confirmAction("End this chat?", "End chat", "Keep chat"))) return;
    if (await send("PUT", "/api/chats/" + id + "/close", {})) refresh();
  };

  await refresh();
  startChatPoll(refresh);
}

function openChatById(id) {
  chatPanel.hidden = false;
  showChat(id);
}

document.getElementById("chat-fab").addEventListener("click", () => {
  if (!chatPanel.hidden) return hideChat();
  chatPanel.hidden = false;
  showChatList();
});
document.getElementById("chat-close").addEventListener("click", hideChat);