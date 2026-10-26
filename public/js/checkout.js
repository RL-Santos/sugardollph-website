// ---------- CHECKOUT (choose address + payment method) ----------

const checkoutOverlay = document.getElementById("checkout-overlay");
const checkoutBox = document.getElementById("checkout-box");
checkoutOverlay.addEventListener("click", e => { if (e.target === checkoutOverlay) checkoutOverlay.hidden = true; });

function checkoutOption(name, value, checked, disabled, title, lines) {
  const input = el("input");
  input.type = "radio";
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  const row = el("label", "co-option" + (disabled ? " disabled" : ""));
  const text = el("div", "co-text");
  text.append(el("b", "", title), ...lines.filter(Boolean).map(t => el("small", "", t)));
  row.append(input, text);
  return row;
}

async function openCheckout() {
  const [addrRes, payRes] = await Promise.all([fetch("/api/addresses"), fetch("/api/payment-methods")]);
  const addresses = addrRes.ok ? await addrRes.json() : [];
  const methods = payRes.ok ? await payRes.json() : [];
  if (addresses.length === 0) {
    cartOverlay.hidden = true;
    showToast("Add a delivery address first.", "error");
    navigate("/account/addresses");
    return;
  }
  const subtotal = cart.reduce((n, i) => n + i.price * i.qty, 0);
  let discount = 0;

  const totalText = el("b");
  const showTotal = () => { totalText.textContent = "Total: PHP " + (subtotal - discount).toFixed(2); };
  showTotal();

  // discount code
  const codeInput = el("input");
  codeInput.placeholder = "Discount code";
  codeInput.maxLength = 30;
  const codeMsg = el("small", "co-code-msg");
  codeInput.addEventListener("input", () => { discount = 0; codeMsg.textContent = ""; showTotal(); });
  const codeRow = el("div", "co-code");
  codeRow.append(codeInput, makeButton("Apply", async () => {
    if (!codeInput.value.trim()) return;
    const data = await send("POST", "/api/discount/check", { code: codeInput.value });
    if (!data) return;
    discount = data.amount;
    codeMsg.textContent = data.code + " applied: -PHP " + data.amount.toFixed(2);
    showTotal();
  }, "secondary-btn"));

  const goTo = path => () => { checkoutOverlay.hidden = true; cartOverlay.hidden = true; navigate(path); };
  const manageAddr = makeButton("Manage addresses", goTo("/account/addresses"), "link-btn");
  const managePay = makeButton("Manage payment info", goTo("/account/payment"), "link-btn");

  const place = makeButton("Place order", async () => {
    const address = checkoutBox.querySelector("input[name=co-address]:checked");
    const pay = checkoutBox.querySelector("input[name=co-pay]:checked");
    if (!address || !pay) return showToast("Pick an address and a payment method.", "error");
    const body = { address_id: Number(address.value), discount_code: codeInput.value.trim() };
    if (pay.value === "COD") body.payment_method = "COD";
    else body.payment_id = Number(pay.value);
    place.disabled = true;
    const data = await send("POST", "/api/checkout", body);
    place.disabled = false;
    if (!data) return;
    checkoutOverlay.hidden = true;
    cartOverlay.hidden = true;
    await loadCart();
    showToast(data.status === "pending" ? "Order placed. Waiting for approval." : "Order placed. We're preparing it now.", "success");
    navigate("/purchases/status");
  });

  const actions = el("div", "co-actions");
  actions.append(totalText, makeButton("Cancel", () => { checkoutOverlay.hidden = true; }, "secondary-btn"), place);

  const hasDefault = methods.some(m => m.is_default);
  checkoutBox.replaceChildren(
    el("h2", "", "Checkout"),
    el("h3", "", "Deliver to"),
    ...addresses.map((a, i) => checkoutOption("co-address", a.id, i === 0, false,
      (a.label || "Address") + (a.is_default ? " (default)" : ""),
      [a.recipient_name + " \u00b7 " + a.phone, [a.street, a.barangay, a.city, a.province, a.postal_code].filter(Boolean).join(", ")])),
    manageAddr,
    el("h3", "", "Payment method"),
    checkoutOption("co-pay", "COD", !hasDefault, false, "Cash on delivery (COD)", ["Pay when your order arrives"]),
    ...methods.map(m => checkoutOption("co-pay", String(m.id), !!m.is_default, false,
      PAY_NAMES[m.type] + (m.is_default ? " (default)" : ""), [payLine(m)])),
    methods.length ? "" : el("p", "chat-note", "Want to pay online? Add GCash, Maya or a card under Payment info."),
    managePay,
    el("h3", "", "Discount code"),
    codeRow, codeMsg,
    actions
  );
  checkoutOverlay.hidden = false;
}