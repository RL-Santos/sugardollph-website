// ---------- CHECKOUT (choose address + payment method) ----------
const PAYMENTS = [
  { key: "COD", label: "Cash on delivery (COD)", note: "Pay when your order arrives", on: true },
  { key: "GCASH", label: "GCash", note: "Coming soon" },
  { key: "MAYA", label: "Maya", note: "Coming soon" },
  { key: "CARD", label: "Credit / debit card", note: "Coming soon" },
  { key: "BANK", label: "Bank transfer", note: "Coming soon" }
];

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
  const res = await fetch("/api/addresses");
  const addresses = res.ok ? await res.json() : [];
  if (addresses.length === 0) {
    cartOverlay.hidden = true;
    showToast("Add a delivery address first.", "error");
    navigate("/account/addresses");
    return;
  }
  const total = cart.reduce((n, i) => n + i.price * i.qty, 0);

  const manage = makeButton("Manage addresses", () => {
    checkoutOverlay.hidden = true;
    cartOverlay.hidden = true;
    navigate("/account/addresses");
  }, "link-btn");

  const place = makeButton("Place order", async () => {
    const address = checkoutBox.querySelector("input[name=co-address]:checked");
    const pay = checkoutBox.querySelector("input[name=co-pay]:checked");
    if (!address || !pay) return showToast("Pick an address and a payment method.", "error");
    place.disabled = true;
    const data = await send("POST", "/api/checkout", { address_id: Number(address.value), payment_method: pay.value });
    place.disabled = false;
    if (!data) return;
    checkoutOverlay.hidden = true;
    cartOverlay.hidden = true;
    await loadCart();
    showToast("Order placed. Waiting for approval.", "success");
    navigate("/purchases/status");
  });

  const actions = el("div", "co-actions");
  actions.append(
    el("b", "", "Total: PHP " + total.toFixed(2)),
    makeButton("Cancel", () => { checkoutOverlay.hidden = true; }, "secondary-btn"),
    place
  );

  checkoutBox.replaceChildren(
    el("h2", "", "Checkout"),
    el("h3", "", "Deliver to"),
    ...addresses.map((a, i) => checkoutOption("co-address", a.id, i === 0, false,
      (a.label || "Address") + (a.is_default ? " (default)" : ""),
      [a.recipient_name + " \u00b7 " + a.phone, [a.street, a.barangay, a.city, a.province, a.postal_code].filter(Boolean).join(", ")])),
    manage,
    el("h3", "", "Payment method"),
    ...PAYMENTS.map(p => checkoutOption("co-pay", p.key, p.on, !p.on, p.label, [p.note])),
    actions
  );
  checkoutOverlay.hidden = false;
}