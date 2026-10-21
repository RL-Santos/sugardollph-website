// Adds a show/hide eye to every password box on the page
const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function addEye(input) {
  if (input.parentElement.classList.contains("pw-wrap")) return;
  const wrap = document.createElement("span");
  wrap.className = "pw-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pw-eye";
  btn.setAttribute("aria-label", "Show password");
  btn.innerHTML = EYE;
  btn.onclick = () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.innerHTML = show ? EYE_OFF : EYE;
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  };
  input.replaceWith(wrap);
  wrap.append(input, btn);
}

function addEyes(root) {
  if (root.matches && root.matches("input[type=password]")) addEye(root);
  root.querySelectorAll("input[type=password]").forEach(addEye);
}

addEyes(document);
new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
  if (n.nodeType === 1) addEyes(n);
}))).observe(document.body, { childList: true, subtree: true });