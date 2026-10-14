/* ============================================================
   PIZZAORA — Artisan Pizza (Integrated Demo Build)
   OIBSIP Web Development & Designing Internship — Level 3 Task 1

   This is a fully working, integrated single-page demonstration of the
   PIZZAORA platform. It simulates the backend in the browser so the entire
   end-to-end flow can be demonstrated without a server:

   - Auth (register/verify/login/forgot/reset) with SHA-256 + salt hashing
   - Menu, multi-step custom pizza builder, cart, checkout
   - Simulated Razorpay TEST-MODE checkout + server-style verification
   - Automatic inventory decrement + negative-stock / out-of-stock prevention
   - Real-time order status sync (admin -> user) via a broadcast event bus
   - node-cron-style scheduled low-stock checks + admin notifications
   - Separate admin login + admin dashboard/orders/inventory/customers

   The full production React + Express + MongoDB + Razorpay source lives in
   OIBSIP/WebDev-L3-PizzaDelivery/. This build mirrors that logic client-side
   for demonstration purposes only.
   ============================================================ */
(function () {
  "use strict";

  /* ============ Storage keys ============ */
  const K = {
    users: "pizzaora_users",
    session: "pizzaora_session",
    admin: "pizzaora_admin_session",
    cart: "pizzaora_cart",
    orders: "pizzaora_orders",
    inventory: "pizzaora_inventory",
    notifs: "pizzaora_notifs",
    resetEmail: "pizzaora_reset_email"
  };
  const TAX_RATE = 0.05;
  const DELIVERY_FEE = 40;
  const ADMIN = { email: "admin@pizzaora.app", password: "Admin@123", name: "Admin" };

  /* ============ Utilities ============ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const money = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = (p) => (p || "") + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

  async function sha256(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  function salt() {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* ============ Toast + Modal ============ */
  function toast(msg, type = "info") {
    const el = document.createElement("div");
    el.className = "toast " + type;
    const icon = type === "success" ? "✓" : type === "error" ? "✕" : "!";
    el.innerHTML = `<span class="ti">${icon}</span><span></span>`;
    el.querySelector("span:last-child").textContent = msg;
    $("#toastArea").appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 3400);
  }
  function modal(html) { $("#modalBox").innerHTML = html; $("#modalBack").classList.add("show"); }
  function closeModal() { $("#modalBack").classList.remove("show"); }
  $("#modalBack").addEventListener("click", (e) => { if (e.target.id === "modalBack") closeModal(); });

  /* ============ Seed data ============ */
  const PIZZAS = [
    { id: "p1", name: "Margherita", cat: "Classic", price: 249, desc: "Fresh mozzarella, San Marzano tomato & basil on a thin crust.", img: "https://images.pexels.com/photos/1049626/pexels-photo-1049626.jpeg?auto=compress&cs=tinysrgb&w=600" },
    { id: "p2", name: "Farmhouse", cat: "Veg", price: 329, desc: "Onion, capsicum, mushroom & tomato loaded with cheese.", img: "https://images.pexels.com/photos/2147491/pexels-photo-2147491.jpeg?auto=compress&cs=tinysrgb&w=600" },
    { id: "p3", name: "BBQ Chicken", cat: "Non-Veg", price: 399, desc: "Smoky BBQ chicken, onion & a rich cheese blend.", img: "https://images.pexels.com/photos/803290/pexels-photo-803290.jpeg?auto=compress&cs=tinysrgb&w=600" },
    { id: "p4", name: "Veggie Supreme", cat: "Veg", price: 359, desc: "A garden of fresh vegetables with double cheese.", img: "https://images.pexels.com/photos/2762942/pexels-photo-2762942.jpeg?auto=compress&cs=tinysrgb&w=600" },
    { id: "p5", name: "Cheese Burst", cat: "Classic", price: 379, desc: "Molten cheese core with a golden crust. Pure indulgence.", img: "https://images.pexels.com/photos/845798/pexels-photo-845798.jpeg?auto=compress&cs=tinysrgb&w=600" },
    { id: "p6", name: "Spicy Paneer", cat: "Veg", price: 349, desc: "Fiery marinated paneer, jalapeño & arrabbiata sauce.", img: "https://images.pexels.com/photos/905847/pexels-photo-905847.jpeg?auto=compress&cs=tinysrgb&w=600" },
    { id: "p7", name: "Pepperoni", cat: "Non-Veg", price: 419, desc: "Classic spicy pepperoni over bubbling mozzarella.", img: "https://images.pexels.com/photos/4109111/pexels-photo-4109111.jpeg?auto=compress&cs=tinysrgb&w=600" }
  ];
  const BASES = [
    { id: "b1", name: "Classic Thin", desc: "Light, crispy & crunchy", price: 0 },
    { id: "b2", name: "Hand Tossed", desc: "Soft & fluffy classic", price: 30 },
    { id: "b3", name: "Italian Crust", desc: "Authentic wood-fired style", price: 50 },
    { id: "b4", name: "Whole Wheat", desc: "Healthy multigrain base", price: 40 },
    { id: "b5", name: "Cheese Burst", desc: "Molten cheese-filled crust", price: 80 }
  ];
  const SAUCES = [
    { id: "s1", name: "Classic Tomato", desc: "Tangy San Marzano", price: 0 },
    { id: "s2", name: "Spicy Arrabbiata", desc: "Chilli-kissed heat", price: 20 },
    { id: "s3", name: "Creamy Garlic", desc: "Rich & smooth", price: 25 },
    { id: "s4", name: "BBQ", desc: "Smoky & sweet", price: 25 },
    { id: "s5", name: "Pesto", desc: "Fresh basil & pine nut", price: 35 }
  ];
  const CHEESES = [
    { id: "c1", name: "Mozzarella", desc: "The classic stretch", price: 0 },
    { id: "c2", name: "Cheddar", desc: "Sharp & golden", price: 25 },
    { id: "c3", name: "Parmesan", desc: "Nutty & aged", price: 35 },
    { id: "c4", name: "Four Cheese Blend", desc: "Ultimate cheese lovers", price: 60 }
  ];
  const VEGGIES = [
    { id: "v1", name: "Onion", price: 15 }, { id: "v2", name: "Capsicum", price: 15 },
    { id: "v3", name: "Mushroom", price: 25 }, { id: "v4", name: "Corn", price: 20 },
    { id: "v5", name: "Jalapeño", price: 20 }, { id: "v6", name: "Olives", price: 25 },
    { id: "v7", name: "Tomato", price: 15 }, { id: "v8", name: "Spinach", price: 15 }
  ];

  /* ============ Inventory init ============ */
  function seedInventory() {
    if (load(K.inventory, null)) return;
    const inv = [];
    BASES.forEach(b => inv.push({ id: "inv_" + b.id, itemName: b.name, category: "Base", stock: 45, threshold: 20 }));
    SAUCES.forEach(s => inv.push({ id: "inv_" + s.id, itemName: s.name, category: "Sauce", stock: 32, threshold: 20 }));
    CHEESES.forEach(c => inv.push({ id: "inv_" + c.id, itemName: c.name, category: "Cheese", stock: 28, threshold: 20 }));
    VEGGIES.forEach(v => inv.push({ id: "inv_" + v.id, itemName: v.name, category: "Vegetable", stock: 40, threshold: 15 }));
    save(K.inventory, inv);
  }
  const getInv = () => load(K.inventory, []);
  const invByName = (name) => getInv().find(i => i.itemName === name);

  /* ============ State helpers ============ */
  const getUsers = () => load(K.users, []);
  const getSession = () => load(K.session, null);
  const getAdmin = () => load(K.admin, null);
  const getCart = () => load(K.cart, []);
  const getOrders = () => load(K.orders, []);
  const getNotifs = () => load(K.notifs, []);

  /* ============ Cross-tab / real-time event bus ============ */
  // Uses storage events (cross-tab) + a local dispatcher (same-tab) so admin
  // status changes reach the user's tracking view automatically (no refresh).
  window.addEventListener("storage", (e) => {
    if (e.key === K.orders) { onOrdersChanged(); }
    if (e.key === K.notifs) { updateNotifDot(); }
  });
  function broadcastOrders() { onOrdersChanged(); }
  function onOrdersChanged() {
    if (currentView === "track") renderTrack(activeTrackId);
    if (currentView === "orders") renderOrders();
    if (getAdmin() && currentView === "admin") renderAdmin(currentAdminTab);
  }

  /* ============ Routing ============ */
  let currentView = "home";
  function go(view, opts) {
    // Guards
    const authViews = ["orders", "cart", "checkout", "track"];
    if (authViews.includes(view) && !getSession()) {
      toast("Please sign in to continue.", "info");
      view = "login";
    }
    if (view === "admin" && !getAdmin()) { view = "adminLogin"; }

    currentView = view;
    $$(".view").forEach(v => v.classList.remove("active"));
    const el = $("#view-" + view);
    if (el) el.classList.add("active");
    // Footer visibility
    $("#footer").style.display = (view === "admin") ? "none" : "block";
    // Nav active state
    $$("#navLinks a").forEach(a => a.classList.toggle("active", a.dataset.nav === view));
    window.scrollTo(0, 0);
    closeMobileNav();

    if (view === "menu") renderMenu();
    if (view === "home") renderFeatured();
    if (view === "builder") { if (opts !== "keep") resetBuilder(); renderBuilder(); }
    if (view === "cart") renderCart();
    if (view === "checkout") renderCheckout();
    if (view === "orders") renderOrders();
    if (view === "track") renderTrack(opts);
    if (view === "admin") renderAdmin("dashboard");
  }

  /* ============ Nav wiring ============ */
  document.body.addEventListener("click", (e) => {
    const nv = e.target.closest("[data-nav]");
    if (nv) { e.preventDefault(); go(nv.dataset.nav); }
  });
  $("#navToggle").addEventListener("click", () => $("#navLinks").classList.toggle("open"));
  function closeMobileNav() { $("#navLinks").classList.remove("open"); }

  function refreshAuthUI() {
    const s = getSession();
    const chip = $("#userChip"), btn = $("#authBtn");
    $$("[data-auth]").forEach(a => a.style.display = s ? "" : "none");
    if (s) {
      chip.classList.remove("hidden"); btn.classList.add("hidden");
      $("#userName").textContent = s.name.split(" ")[0];
      $("#userAv").textContent = s.name.trim().split(/\s+/).map(x => x[0]).slice(0, 2).join("").toUpperCase();
    } else { chip.classList.add("hidden"); btn.classList.remove("hidden"); }
    updateCartCount();
  }
  // clicking chip -> logout menu
  $("#userChip").addEventListener("click", () => {
    modal(`<div class="m-icon" style="background:rgba(242,169,59,.15)">👋</div>
      <h2>Account</h2><p>Signed in as ${esc(getSession().email)}</p>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn btn-ghost" id="mProfileClose">Close</button>
        <button class="btn btn-primary" id="mLogout">Logout</button></div>`);
    $("#mLogout").addEventListener("click", () => { localStorage.removeItem(K.session); refreshAuthUI(); closeModal(); toast("You have been signed out.", "info"); go("home"); });
    $("#mProfileClose").addEventListener("click", closeModal);
  });

  /* ============ Cart ============ */
  function updateCartCount() {
    const n = getCart().reduce((s, i) => s + i.qty, 0);
    const c = $("#cartCount");
    if (n > 0) { c.classList.remove("hidden"); c.textContent = n; } else c.classList.add("hidden");
  }
  function addToCart(item) {
    const cart = getCart();
    cart.push({ ...item, cartId: uid("ci_"), qty: 1 });
    save(K.cart, cart); updateCartCount();
    toast(item.name + " added to cart", "success");
  }

  /* ============ Render: Featured / Menu ============ */
  function pizzaCard(p) {
    return `<div class="pcard">
      <div class="pcard-img"><img src="${p.img}" alt="${esc(p.name)} pizza" loading="lazy"></div>
      <div class="pcard-body">
        <div class="pcard-tag">${esc(p.cat)}</div>
        <h3>${esc(p.name)}</h3><p>${esc(p.desc)}</p>
        <div class="pcard-foot"><div class="price">${money(p.price)}<small> / regular</small></div>
        <button class="btn btn-primary btn-sm" data-add="${p.id}">Add +</button></div>
      </div></div>`;
  }
  function renderFeatured() {
    $("#featuredGrid").innerHTML = PIZZAS.slice(0, 4).map(pizzaCard).join("");
  }
  function renderMenu() {
    $("#menuGrid").innerHTML = PIZZAS.map(pizzaCard).join("");
  }
  document.body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (!add) return;
    const p = PIZZAS.find(x => x.id === add.dataset.add);
    addToCart({ type: "preset", pizzaId: p.id, name: p.name, img: p.img, unit: p.price, ingredients: { base: "Hand Tossed", sauce: "Classic Tomato", cheese: ["Mozzarella"], veggies: [] }, custom: "Chef's classic recipe" });
  });

  /* ============ Pizza Builder ============ */
  const STEP_NAMES = ["Base", "Sauce", "Cheese", "Veggies"];
  let bStep = 0;
  let bSel = { base: null, sauce: null, cheese: [], veggies: [] };
  function resetBuilder() { bStep = 0; bSel = { base: null, sauce: null, cheese: [], veggies: [] }; }

  function builderPrice() {
    let p = 99; // base build price
    const b = BASES.find(x => x.id === bSel.base); if (b) p += b.price;
    const s = SAUCES.find(x => x.id === bSel.sauce); if (s) p += s.price;
    bSel.cheese.forEach(id => { const c = CHEESES.find(x => x.id === id); if (c) p += c.price; });
    bSel.veggies.forEach(id => { const v = VEGGIES.find(x => x.id === id); if (v) p += v.price; });
    return p;
  }
  function renderSteps() {
    $("#builderSteps").innerHTML = STEP_NAMES.map((n, i) => {
      const cls = i === bStep ? "active" : (i < bStep ? "done" : "");
      const line = i < STEP_NAMES.length - 1 ? '<div class="step-line"></div>' : "";
      return `<div class="step ${cls}"><span class="num">${i < bStep ? "✓" : i + 1}</span><span class="lbl">${n}</span></div>${line}`;
    }).join("");
  }
  function renderBuilder() {
    renderSteps();
    const box = $("#builderStep");
    if (bStep === 0) {
      box.innerHTML = `<h3 style="margin-bottom:14px;">Choose your base</h3><div class="opt-grid">` +
        BASES.map(b => `<div class="opt ${bSel.base === b.id ? "sel" : ""}" data-base="${b.id}"><h4>${b.name}</h4><p>${b.desc}</p><span class="op">${b.price ? "+" + money(b.price) : "Included"}</span></div>`).join("") + `</div>`;
    } else if (bStep === 1) {
      box.innerHTML = `<h3 style="margin-bottom:14px;">Choose your sauce</h3><div class="opt-grid">` +
        SAUCES.map(s => `<div class="opt ${bSel.sauce === s.id ? "sel" : ""}" data-sauce="${s.id}"><h4>${s.name}</h4><p>${s.desc}</p><span class="op">${s.price ? "+" + money(s.price) : "Included"}</span></div>`).join("") + `</div>`;
    } else if (bStep === 2) {
      box.innerHTML = `<h3 style="margin-bottom:14px;">Choose your cheese <small style="color:var(--muted);font-weight:400">(select one or more)</small></h3><div class="opt-grid">` +
        CHEESES.map(c => `<div class="opt ${bSel.cheese.includes(c.id) ? "sel" : ""}" data-cheese="${c.id}"><h4>${c.name}</h4><p>${c.desc}</p><span class="op">${c.price ? "+" + money(c.price) : "Included"}</span></div>`).join("") + `</div>`;
    } else {
      box.innerHTML = `<h3 style="margin-bottom:14px;">Add vegetables <small style="color:var(--muted);font-weight:400">(optional, multiple)</small></h3><div class="opt-grid">` +
        VEGGIES.map(v => `<div class="opt ${bSel.veggies.includes(v.id) ? "sel" : ""}" data-veg="${v.id}"><h4>${v.name}</h4><span class="op">+${money(v.price)}</span></div>`).join("") + `</div>`;
    }
    $("#livePrice").textContent = builderPrice();
    $("#builderBack").textContent = bStep === 0 ? "← Menu" : "← Back";
    $("#builderNext").textContent = bStep === 3 ? "Review Pizza →" : "Next →";
  }
  $("#builderStep").addEventListener("click", (e) => {
    const o = e.target.closest(".opt"); if (!o) return;
    if (o.dataset.base) bSel.base = o.dataset.base;
    else if (o.dataset.sauce) bSel.sauce = o.dataset.sauce;
    else if (o.dataset.cheese) { const id = o.dataset.cheese; bSel.cheese = bSel.cheese.includes(id) ? bSel.cheese.filter(x => x !== id) : [...bSel.cheese, id]; }
    else if (o.dataset.veg) { const id = o.dataset.veg; bSel.veggies = bSel.veggies.includes(id) ? bSel.veggies.filter(x => x !== id) : [...bSel.veggies, id]; }
    renderBuilder();
  });
  $("#builderBack").addEventListener("click", () => { if (bStep === 0) go("menu"); else { bStep--; renderBuilder(); } });
  $("#builderNext").addEventListener("click", () => {
    if (bStep === 0 && !bSel.base) return toast("Please choose a base.", "error");
    if (bStep === 1 && !bSel.sauce) return toast("Please choose a sauce.", "error");
    if (bStep === 2 && bSel.cheese.length === 0) return toast("Please choose at least one cheese.", "error");
    if (bStep < 3) { bStep++; renderBuilder(); return; }
    reviewCustom();
  });
  function reviewCustom() {
    const base = BASES.find(x => x.id === bSel.base);
    const sauce = SAUCES.find(x => x.id === bSel.sauce);
    const cheese = bSel.cheese.map(id => CHEESES.find(x => x.id === id).name);
    const veggies = bSel.veggies.map(id => VEGGIES.find(x => x.id === id).name);
    const sub = builderPrice();
    const tax = Math.round(sub * TAX_RATE);
    modal(`<div style="text-align:left">
      <h2 style="font-family:var(--serif);text-align:center;margin-bottom:14px;">Review Your Pizza</h2>
      <div class="sum-row"><span>Base</span><b style="color:var(--text)">${base.name}</b></div>
      <div class="sum-row"><span>Sauce</span><b style="color:var(--text)">${sauce.name}</b></div>
      <div class="sum-row"><span>Cheese</span><b style="color:var(--text)">${cheese.join(", ")}</b></div>
      <div class="sum-row"><span>Vegetables</span><b style="color:var(--text)">${veggies.length ? veggies.join(", ") : "None"}</b></div>
      <div class="sum-row"><span>Subtotal</span><span>${money(sub)}</span></div>
      <div class="sum-row"><span>Taxes (5%)</span><span>${money(tax)}</span></div>
      <div class="sum-row"><span>Delivery</span><span>${money(DELIVERY_FEE)}</span></div>
      <div class="sum-row total"><span>Total</span><span>${money(sub + tax + DELIVERY_FEE)}</span></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button class="btn btn-ghost btn-block" id="mCancel">Keep Editing</button>
        <button class="btn btn-primary btn-block" id="mAddCustom">Add to Cart</button></div></div>`);
    $("#mCancel").addEventListener("click", closeModal);
    $("#mAddCustom").addEventListener("click", () => {
      addToCart({
        type: "custom", pizzaId: "custom", name: "Custom Pizza",
        img: "https://images.pexels.com/photos/708587/pexels-photo-708587.jpeg?auto=compress&cs=tinysrgb&w=600",
        unit: sub,
        ingredients: { base: base.name, sauce: sauce.name, cheese, veggies },
        custom: `${base.name} · ${sauce.name} · ${cheese.join("/")}${veggies.length ? " · " + veggies.join(", ") : ""}`
      });
      closeModal(); resetBuilder(); go("cart");
    });
  }

  /* ============ Cart view ============ */
  function cartTotals(cart) {
    const subtotal = cart.reduce((s, i) => s + i.unit * i.qty, 0);
    const taxes = Math.round(subtotal * TAX_RATE);
    const delivery = cart.length ? DELIVERY_FEE : 0;
    return { subtotal, taxes, delivery, total: subtotal + taxes + delivery };
  }
  function renderCart() {
    const cart = getCart();
    const box = $("#cartLayout");
    if (!cart.length) {
      box.innerHTML = `<div class="panel" style="grid-column:1/-1"><div class="empty"><div class="ei">🛒</div><h3>Your cart is empty</h3><p>Add a pizza to get started.</p><button class="btn btn-primary" style="margin-top:14px" data-nav="menu">Browse Menu</button></div></div>`;
      return;
    }
    const t = cartTotals(cart);
    box.innerHTML = `
      <div class="panel">${cart.map(i => `
        <div class="cart-item">
          <img src="${i.img}" alt="${esc(i.name)}">
          <div class="ci-body"><h4>${esc(i.name)}</h4><div class="custom">${esc(i.custom)}</div>
            <div class="qty"><button data-dec="${i.cartId}">−</button><span>${i.qty}</span><button data-inc="${i.cartId}">+</button></div></div>
          <div class="ci-right"><b class="price">${money(i.unit * i.qty)}</b><button class="remove" data-rem="${i.cartId}">Remove</button></div>
        </div>`).join("")}
      </div>
      <div class="panel dark">
        <h3 style="margin-bottom:14px;">Order Summary</h3>
        <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        <div class="sum-row"><span>Taxes (5%)</span><span>${money(t.taxes)}</span></div>
        <div class="sum-row"><span>Delivery</span><span>${money(t.delivery)}</span></div>
        <div class="sum-row total"><span>Grand Total</span><span>${money(t.total)}</span></div>
        <button class="btn btn-primary btn-block" style="margin-top:16px" id="toCheckout">Proceed to Checkout</button>
      </div>`;
    $("#toCheckout").addEventListener("click", () => { if (!getSession()) { toast("Please sign in to checkout.", "info"); go("login"); } else go("checkout"); });
  }
  document.body.addEventListener("click", (e) => {
    const inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]"), rem = e.target.closest("[data-rem]");
    if (!inc && !dec && !rem) return;
    let cart = getCart();
    if (inc) { const it = cart.find(i => i.cartId === inc.dataset.inc); it.qty++; }
    if (dec) { const it = cart.find(i => i.cartId === dec.dataset.dec); it.qty = Math.max(1, it.qty - 1); }
    if (rem) { cart = cart.filter(i => i.cartId !== rem.dataset.rem); }
    save(K.cart, cart); updateCartCount(); renderCart();
  });

  /* ============ Checkout ============ */
  function renderCheckout() {
    const cart = getCart();
    if (!cart.length) { toast("Your cart is empty.", "error"); go("cart"); return; }
    const s = getSession();
    const t = cartTotals(cart);
    $("#checkoutLayout").innerHTML = `
      <div class="panel dark">
        <h3 style="margin-bottom:14px;">Delivery Details</h3>
        <div class="field"><label>Full Name</label><input id="coName" value="${esc(s.name)}"></div>
        <div class="field"><label>Email</label><input id="coEmail" value="${esc(s.email)}" disabled></div>
        <div class="field"><label>Phone</label><input id="coPhone" placeholder="10-digit mobile"></div>
        <div class="field"><label>Delivery Address</label><input id="coAddr" placeholder="House, street, area, city"></div>
        <h3 style="margin:18px 0 10px;">Items</h3>
        ${cart.map(i => `<div class="sum-row"><span>${esc(i.name)} × ${i.qty}<br><small style="color:var(--muted-2)">${esc(i.custom)}</small></span><span>${money(i.unit * i.qty)}</span></div>`).join("")}
      </div>
      <div class="panel dark">
        <h3 style="margin-bottom:14px;">Payment Summary</h3>
        <div class="sum-row"><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        <div class="sum-row"><span>Taxes (5%)</span><span>${money(t.taxes)}</span></div>
        <div class="sum-row"><span>Delivery</span><span>${money(t.delivery)}</span></div>
        <div class="sum-row total"><span>Total</span><span>${money(t.total)}</span></div>
        <button class="btn btn-primary btn-block" style="margin-top:16px" id="payBtn">🔒 Pay Securely ${money(t.total)}</button>
        <p style="text-align:center;color:var(--muted);font-size:.78rem;margin-top:10px;">Powered by Razorpay · <b>TEST MODE</b></p>
      </div>`;
    $("#payBtn").addEventListener("click", startPayment);
  }

  // Check inventory availability for the whole cart
  function checkAvailability(cart) {
    const need = {};
    cart.forEach(i => {
      const g = i.ingredients;
      const bump = (n) => { need[n] = (need[n] || 0) + i.qty; };
      if (g.base) bump(g.base);
      if (g.sauce) bump(g.sauce);
      (g.cheese || []).forEach(bump);
      (g.veggies || []).forEach(bump);
    });
    for (const name in need) {
      const inv = invByName(name);
      if (inv && inv.stock < need[name]) return { ok: false, item: name };
    }
    return { ok: true };
  }
  function decrementInventory(cart) {
    const inv = getInv();
    cart.forEach(i => {
      const g = i.ingredients;
      const dec = (n) => { const it = inv.find(x => x.itemName === n); if (it) it.stock = Math.max(0, it.stock - i.qty); };
      if (g.base) dec(g.base);
      if (g.sauce) dec(g.sauce);
      (g.cheese || []).forEach(dec);
      (g.veggies || []).forEach(dec);
    });
    save(K.inventory, inv);
    runLowStockCheck(); // immediate check after order
  }

  // ---- Simulated Razorpay TEST-MODE flow (server-order + verify) ----
  function startPayment() {
    const phone = $("#coPhone").value.trim();
    const addr = $("#coAddr").value.trim();
    if (!/^\d{10}$/.test(phone)) return toast("Enter a valid 10-digit phone number.", "error");
    if (addr.length < 8) return toast("Please enter a delivery address.", "error");

    const cart = getCart();
    const avail = checkAvailability(cart);
    if (!avail.ok) { return toast(`Sorry, "${avail.item}" is out of stock. Please adjust your order.`, "error"); }

    const t = cartTotals(cart);
    // Simulated Razorpay checkout modal (test mode)
    modal(`<div style="text-align:left">
      <div style="text-align:center;margin-bottom:14px;">
        <div style="display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:1.2rem;color:#3395ff;">Razorpay <span style="font-size:.7rem;background:#3395ff;color:#fff;padding:2px 8px;border-radius:6px;">TEST</span></div>
      </div>
      <p style="text-align:center;color:var(--muted);margin-bottom:16px;">Pay ${money(t.total)} to PIZZAORA</p>
      <div class="field"><label>Card Number (test)</label><input id="rpCard" value="4111 1111 1111 1111"></div>
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1"><label>Expiry</label><input id="rpExp" value="12/28"></div>
        <div class="field" style="flex:1"><label>CVV</label><input id="rpCvv" value="123"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <button class="btn btn-ghost btn-block" id="rpFail">Simulate Failure</button>
        <button class="btn btn-primary btn-block" id="rpPay">Pay ${money(t.total)}</button>
      </div>
      <p style="text-align:center;color:var(--muted-2);font-size:.72rem;margin-top:10px;">No real money is charged. Razorpay test environment.</p>
    </div>`);
    $("#rpFail").addEventListener("click", () => {
      closeModal();
      toast("Payment failed. Your order was not placed — please retry.", "error");
    });
    $("#rpPay").addEventListener("click", () => finalizePayment(phone, addr));
  }

  async function finalizePayment(phone, addr) {
    const box = $("#modalBox");
    box.innerHTML = `<div class="spinner"></div><p style="text-align:center;color:var(--muted)">Verifying payment securely…</p>`;
    const cart = getCart();
    const t = cartTotals(cart);
    const s = getSession();

    // Simulate server-side order create + signature verification
    const razorOrderId = "order_" + uid();
    const paymentId = "pay_" + uid();
    const signature = await sha256(razorOrderId + "|" + paymentId + "|test_secret");
    const verify = await sha256(razorOrderId + "|" + paymentId + "|test_secret");
    const verified = signature === verify; // server-style verification

    await new Promise(r => setTimeout(r, 700));

    if (!verified) { modal(`<div class="m-icon" style="background:rgba(226,58,46,.15)">✕</div><h2>Payment Verification Failed</h2><p>Please try again.</p><button class="btn btn-primary" id="mc">Close</button>`); $("#mc").addEventListener("click", closeModal); return; }

    // Create order, decrement inventory
    const order = {
      id: "PZA" + Date.now().toString().slice(-8),
      userEmail: s.email, userName: s.name, phone, address: addr,
      items: cart, ...t,
      paymentStatus: "Paid", paymentId, razorOrderId,
      orderStatus: "Order Received",
      createdAt: Date.now(),
      timeline: [{ status: "Order Received", at: Date.now() }]
    };
    const orders = getOrders(); orders.unshift(order); save(K.orders, orders);
    decrementInventory(cart);
    save(K.cart, []); updateCartCount();
    broadcastOrders();

    // Confirmation
    modal(`<div class="m-icon">✓</div>
      <h2>Order Confirmed!</h2>
      <p>Thank you, ${esc(s.name.split(" ")[0])}! Your pizza is being prepared.</p>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:left;margin-bottom:18px;">
        <div class="sum-row"><span>Order ID</span><b style="color:var(--text)">${order.id}</b></div>
        <div class="sum-row"><span>Total Paid</span><b style="color:var(--green)">${money(order.total)}</b></div>
        <div class="sum-row"><span>Payment</span><span class="badge b-paid">Paid</span></div>
        <div class="sum-row"><span>Est. Prep</span><span>20–25 mins</span></div>
      </div>
      <button class="btn btn-primary btn-block" id="mTrack">Track My Order →</button>`);
    $("#mTrack").addEventListener("click", () => { closeModal(); go("track", order.id); });
  }

  /* ============ Order tracking ============ */
  const STAGES = ["Order Received", "In Kitchen", "Sent to Delivery"];
  let activeTrackId = null;
  function renderTrack(orderId) {
    activeTrackId = orderId || activeTrackId;
    const order = getOrders().find(o => o.id === activeTrackId);
    const box = $("#trackContent");
    if (!order) { box.innerHTML = `<div class="empty"><div class="ei">🔍</div><h3>Order not found</h3><button class="btn btn-primary" style="margin-top:12px" data-nav="orders">My Orders</button></div>`; return; }
    $("#trackSub").textContent = "Order " + order.id + " · Live status (auto-updates)";
    const idx = STAGES.indexOf(order.orderStatus);
    const descs = ["We've received your order and payment.", "Our chefs are crafting your pizza with love.", "Your pizza is on its way to you!"];
    box.innerHTML = `
      <div class="panel dark" style="margin-bottom:20px;">
        <div class="tracker">${STAGES.map((st, i) => {
          const cls = i < idx ? "done" : (i === idx ? "current" : "");
          const mark = i < idx ? "✓" : (i === idx ? "●" : (i + 1));
          return `<div class="tstage ${cls}"><div class="tdot">${mark}</div><div><h4>${st}</h4><p>${descs[i]}</p></div></div>`;
        }).join("")}</div>
      </div>
      <div class="panel dark">
        <h3 style="margin-bottom:12px;">Order Items</h3>
        ${order.items.map(i => `<div class="sum-row"><span>${esc(i.name)} × ${i.qty}<br><small style="color:var(--muted-2)">${esc(i.custom)}</small></span><span>${money(i.unit * i.qty)}</span></div>`).join("")}
        <div class="sum-row total"><span>Total Paid</span><span>${money(order.total)}</span></div>
      </div>`;
  }

  /* ============ My Orders ============ */
  function statusBadge(st) {
    const map = { "Order Received": "b-received", "In Kitchen": "b-kitchen", "Sent to Delivery": "b-delivery" };
    return `<span class="badge ${map[st]}">${st}</span>`;
  }
  function renderOrders() {
    const s = getSession();
    const orders = getOrders().filter(o => o.userEmail === s.email);
    const box = $("#ordersList");
    if (!orders.length) { box.innerHTML = `<div class="empty"><div class="ei">📦</div><h3>No orders yet</h3><p>Your delicious journey starts here.</p><button class="btn btn-primary" style="margin-top:12px" data-nav="menu">Order Now</button></div>`; return; }
    box.innerHTML = orders.map(o => `
      <div class="order-card">
        <div class="order-head">
          <div><b style="font-size:1.05rem;">${o.id}</b><br><small style="color:var(--muted-2)">${new Date(o.createdAt).toLocaleString("en-IN")}</small></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">${statusBadge(o.orderStatus)}<span class="badge b-paid">Paid</span></div>
        </div>
        <div style="color:var(--muted-2);font-size:.88rem;margin-bottom:12px;">${o.items.map(i => esc(i.name) + " ×" + i.qty).join(", ")}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <b class="price">${money(o.total)}</b>
          <button class="btn btn-outline btn-sm" data-track="${o.id}">Track / Details</button>
        </div>
      </div>`).join("");
  }
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-track]"); if (t) go("track", t.dataset.track);
  });

  /* ============ AUTH ============ */
  function fieldErr(inp, msg, txt) { const i = $(inp), m = $(msg); if (txt) { i.classList.add("err"); m.textContent = txt; m.classList.add("show"); } else { i.classList.remove("err"); m.textContent = ""; m.classList.remove("show"); } }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const validPw = (p) => p.length >= 8 && /[0-9]/.test(p);

  // switches
  $("#toRegister").addEventListener("click", () => go("register"));
  $("#toLogin").addEventListener("click", () => go("login"));
  $("#toLogin2").addEventListener("click", () => go("login"));
  $("#toForgot").addEventListener("click", () => go("forgot"));

  // Password strength
  $("#regPassword").addEventListener("input", (e) => {
    const p = e.target.value, box = $("#strength"), fill = $("#strengthFill"), lbl = $("#strengthLabel");
    if (!p) { box.classList.remove("show"); return; }
    box.classList.add("show");
    let sc = 0; if (p.length >= 8) sc++; if (/[A-Z]/.test(p) && /[a-z]/.test(p)) sc++; if (/[0-9]/.test(p)) sc++; if (/[^A-Za-z0-9]/.test(p)) sc++;
    const map = [["Weak", "#E23A2E", "25%"], ["Fair", "#F2A93B", "50%"], ["Good", "#3395ff", "75%"], ["Strong", "#2FB673", "100%"]];
    const m = map[Math.max(0, sc - 1)];
    fill.style.width = m[2]; fill.style.background = m[1]; lbl.textContent = "Strength: " + m[0]; lbl.style.color = m[1];
  });

  // Register
  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#regName").value.trim().replace(/\s+/g, " ");
    const email = $("#regEmail").value.trim().toLowerCase();
    const pw = $("#regPassword").value, cf = $("#regConfirm").value;
    let ok = true;
    if (!name || name.length < 2) { fieldErr("#regName", "#regNameMsg", "Please enter your full name."); ok = false; } else fieldErr("#regName", "#regNameMsg");
    if (!EMAIL_RE.test(email)) { fieldErr("#regEmail", "#regEmailMsg", "Enter a valid email address."); ok = false; } else fieldErr("#regEmail", "#regEmailMsg");
    if (!validPw(pw)) { fieldErr("#regPassword", "#regPasswordMsg", "Min 8 characters and at least one number."); ok = false; } else fieldErr("#regPassword", "#regPasswordMsg");
    if (cf !== pw) { fieldErr("#regConfirm", "#regConfirmMsg", "Passwords do not match."); ok = false; } else fieldErr("#regConfirm", "#regConfirmMsg");
    if (!ok) return;
    const users = getUsers();
    if (users.find(u => u.email === email)) { fieldErr("#regEmail", "#regEmailMsg", "An account with this email already exists."); return; }
    const st = salt(); const hash = await sha256(st + ":" + pw);
    const verifyToken = uid("vt_");
    users.push({ id: uid("u_"), name, email, salt: st, hash, role: "user", emailVerified: false, verifyToken, createdAt: Date.now() });
    save(K.users, users);
    // Simulated verification email
    modal(`<div class="m-icon" style="background:rgba(51,149,255,.15)">✉️</div>
      <h2>Verify your email</h2>
      <p>We sent a verification link to <b>${esc(email)}</b>. In this demo, click below to verify instantly.</p>
      <button class="btn btn-primary btn-block" id="mVerify">Verify Email Now</button>`);
    $("#mVerify").addEventListener("click", () => {
      const us = getUsers(); const u = us.find(x => x.email === email); u.emailVerified = true; delete u.verifyToken; save(K.users, us);
      closeModal(); toast("Email verified! You can now sign in.", "success"); go("login"); $("#loginEmail").value = email;
    });
  });

  // Login
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim().toLowerCase(), pw = $("#loginPassword").value;
    let ok = true;
    if (!EMAIL_RE.test(email)) { fieldErr("#loginEmail", "#loginEmailMsg", "Enter a valid email."); ok = false; } else fieldErr("#loginEmail", "#loginEmailMsg");
    if (!pw) { fieldErr("#loginPassword", "#loginPasswordMsg", "Enter your password."); ok = false; } else fieldErr("#loginPassword", "#loginPasswordMsg");
    if (!ok) return;
    const u = getUsers().find(x => x.email === email);
    let auth = false;
    if (u) auth = (await sha256(u.salt + ":" + pw)) === u.hash;
    else await sha256("dummy:" + pw);
    if (!auth) { fieldErr("#loginPassword", "#loginPasswordMsg", "Invalid email or password."); toast("Invalid email or password.", "error"); return; }
    if (!u.emailVerified) {
      toast("Please verify your email first.", "info");
      modal(`<div class="m-icon" style="background:rgba(51,149,255,.15)">✉️</div><h2>Verify your email</h2><p>Verify <b>${esc(email)}</b> to continue.</p><button class="btn btn-primary btn-block" id="mVerify2">Verify Now</button>`);
      $("#mVerify2").addEventListener("click", () => { const us = getUsers(); us.find(x => x.email === email).emailVerified = true; save(K.users, us); closeModal(); toast("Verified! Please sign in.", "success"); });
      return;
    }
    save(K.session, { id: u.id, name: u.name, email: u.email });
    refreshAuthUI(); toast("Welcome back, " + u.name.split(" ")[0] + "!", "success");
    $("#loginForm").reset();
    go(getCart().length ? "cart" : "home");
  });

  // Forgot
  $("#forgotForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("#forgotEmail").value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { fieldErr("#forgotEmail", "#forgotEmailMsg", "Enter a valid email."); return; }
    fieldErr("#forgotEmail", "#forgotEmailMsg");
    // Always show same message (no account enumeration)
    const u = getUsers().find(x => x.email === email);
    if (u) { u.resetToken = uid("rt_"); u.resetExpiry = Date.now() + 15 * 60000; save(K.users, getUsers().map(x => x.id === u.id ? u : x)); save(K.resetEmail, email); }
    modal(`<div class="m-icon" style="background:rgba(51,149,255,.15)">🔑</div>
      <h2>Check your email</h2>
      <p>If an account exists for <b>${esc(email)}</b>, a reset link has been sent. In this demo, continue below.</p>
      <button class="btn btn-primary btn-block" id="mReset" ${u ? "" : "disabled"}>Reset Password</button>
      ${u ? "" : '<p style="color:var(--muted-2);font-size:.78rem;margin-top:10px;">No matching demo account.</p>'}`);
    if (u) $("#mReset").addEventListener("click", () => { closeModal(); go("reset"); });
  });

  // Reset
  $("#resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = $("#resetPassword").value, cf = $("#resetConfirm").value;
    let ok = true;
    if (!validPw(pw)) { fieldErr("#resetPassword", "#resetPasswordMsg", "Min 8 chars & one number."); ok = false; } else fieldErr("#resetPassword", "#resetPasswordMsg");
    if (cf !== pw) { fieldErr("#resetConfirm", "#resetConfirmMsg", "Passwords do not match."); ok = false; } else fieldErr("#resetConfirm", "#resetConfirmMsg");
    if (!ok) return;
    const email = load(K.resetEmail, null); const users = getUsers(); const u = users.find(x => x.email === email);
    if (!u || !u.resetToken || Date.now() > u.resetExpiry) { toast("Reset link expired. Please try again.", "error"); go("forgot"); return; }
    u.salt = salt(); u.hash = await sha256(u.salt + ":" + pw); delete u.resetToken; delete u.resetExpiry;
    save(K.users, users); localStorage.removeItem(K.resetEmail);
    toast("Password updated! Please sign in.", "success"); $("#resetForm").reset(); go("login");
  });

  /* ============ ADMIN ============ */
  $("#adminLoginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("#adminEmail").value.trim().toLowerCase(), pw = $("#adminPassword").value;
    if (email !== ADMIN.email || pw !== ADMIN.password) {
      fieldErr("#adminPassword", "#adminPasswordMsg", "Invalid admin credentials.");
      toast("Invalid admin credentials.", "error"); return;
    }
    fieldErr("#adminPassword", "#adminPasswordMsg");
    save(K.admin, { email: ADMIN.email, name: ADMIN.name, ts: Date.now() });
    $("#adminLoginForm").reset();
    toast("Welcome, Admin.", "success"); go("admin");
  });
  $("#adminLogout").addEventListener("click", () => { localStorage.removeItem(K.admin); toast("Admin signed out.", "info"); go("home"); });

  let currentAdminTab = "dashboard";
  $$("[data-admin]").forEach(a => a.addEventListener("click", () => { renderAdmin(a.dataset.admin); }));

  function renderAdmin(tab) {
    if (!getAdmin()) { go("adminLogin"); return; }
    currentAdminTab = tab;
    $$("[data-admin]").forEach(a => a.classList.toggle("active", a.dataset.admin === tab));
    const box = $("#adminContent");
    const orders = getOrders();
    if (tab === "dashboard") {
      const pending = orders.filter(o => o.orderStatus !== "Sent to Delivery").length;
      const done = orders.filter(o => o.orderStatus === "Sent to Delivery").length;
      const low = getInv().filter(i => i.stock < i.threshold).length;
      box.innerHTML = `<h2 style="font-family:var(--serif);margin-bottom:6px;">Dashboard</h2><p style="color:var(--muted);margin-bottom:24px;">Overview of PIZZAORA operations.</p>
        <div class="stat-grid">
          <div class="stat"><div class="si" style="background:rgba(51,149,255,.15)">📦</div><div class="sv">${orders.length}</div><div class="sl">Total Orders</div></div>
          <div class="stat"><div class="si" style="background:rgba(242,169,59,.15)">⏳</div><div class="sv">${pending}</div><div class="sl">Pending Orders</div></div>
          <div class="stat"><div class="si" style="background:rgba(47,182,115,.15)">✅</div><div class="sv">${done}</div><div class="sl">Completed Orders</div></div>
          <div class="stat"><div class="si" style="background:rgba(226,58,46,.15)">⚠️</div><div class="sv ${low ? "inv-low" : ""}">${low}</div><div class="sl">Low Stock Items</div></div>
        </div>
        <h3 style="margin-bottom:12px;">Recent Orders</h3>
        ${orders.length ? adminOrderTable(orders.slice(0, 6)) : emptyRow("No orders yet.")}`;
    } else if (tab === "orders") {
      box.innerHTML = `<h2 style="font-family:var(--serif);margin-bottom:20px;">Order Management</h2>${orders.length ? adminOrderTable(orders, true) : `<div class="empty"><div class="ei">📦</div><h3>No incoming orders</h3></div>`}`;
    } else if (tab === "inventory") {
      const inv = getInv();
      box.innerHTML = `<h2 style="font-family:var(--serif);margin-bottom:6px;">Inventory</h2><p style="color:var(--muted);margin-bottom:20px;">Stock auto-decrements after each order. Items below threshold are flagged.</p>
        <table><thead><tr><th>Item</th><th>Category</th><th>Stock</th><th>Threshold</th><th>Adjust</th></tr></thead><tbody>
        ${inv.map(i => `<tr>
          <td>${esc(i.itemName)}</td><td>${i.category}</td>
          <td class="${i.stock < i.threshold ? "inv-low" : ""}">${i.stock}${i.stock < i.threshold ? " ⚠️" : ""}</td>
          <td>${i.threshold}</td>
          <td><span class="stock-ctrl"><button data-stock="${i.id}" data-d="-1">−</button><input type="number" value="${i.stock}" data-set="${i.id}"><button data-stock="${i.id}" data-d="1">+</button></span></td>
        </tr>`).join("")}</tbody></table>`;
    } else if (tab === "customers") {
      const users = getUsers();
      box.innerHTML = `<h2 style="font-family:var(--serif);margin-bottom:20px;">Customers</h2>${users.length ? `<table><thead><tr><th>Name</th><th>Email</th><th>Verified</th><th>Orders</th><th>Joined</th></tr></thead><tbody>
        ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.emailVerified ? '<span class="badge b-paid">Yes</span>' : '<span class="badge b-pending">No</span>'}</td><td>${orders.filter(o => o.userEmail === u.email).length}</td><td>${new Date(u.createdAt).toLocaleDateString("en-IN")}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty"><div class="ei">👥</div><h3>No customers yet</h3></div>`}`;
    } else if (tab === "notifications") {
      const nf = getNotifs();
      box.innerHTML = `<h2 style="font-family:var(--serif);margin-bottom:20px;">Notifications</h2>
        ${nf.length ? nf.map(n => `<div class="notif"><span class="ni">⚠️</span><div><b>${esc(n.title)}</b><br><span style="color:var(--muted);font-size:.85rem;">${esc(n.body)}</span><br><small style="color:var(--muted-2)">${new Date(n.at).toLocaleString("en-IN")}</small></div></div>`).join("") : `<div class="empty"><div class="ei">🔔</div><h3>No notifications</h3><p>Low-stock alerts will appear here.</p></div>`}`;
    }
    updateNotifDot();
  }
  function emptyRow(t) { return `<div class="empty" style="padding:30px"><p>${t}</p></div>`; }
  function adminOrderTable(orders, manage) {
    return `<table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${orders.map(o => `<tr>
        <td><b>${o.id}</b></td>
        <td>${esc(o.userName)}<br><small style="color:var(--muted-2)">${esc(o.phone || "")}</small></td>
        <td>${o.items.map(i => esc(i.name) + " ×" + i.qty).join("<br>")}</td>
        <td>${money(o.total)}</td>
        <td><span class="badge b-paid">Paid</span></td>
        <td>${manage ? `<select class="status-select" data-order="${o.id}">${STAGES.map(s => `<option ${o.orderStatus === s ? "selected" : ""}>${s}</option>`).join("")}</select>` : statusBadge(o.orderStatus)}</td>
      </tr>`).join("")}</tbody></table>`;
  }
  // Admin actions
  $("#adminContent").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-order]");
    if (sel) {
      const orders = getOrders(); const o = orders.find(x => x.id === sel.dataset.order);
      o.orderStatus = sel.value; o.timeline.push({ status: sel.value, at: Date.now() });
      save(K.orders, orders); broadcastOrders();
      toast(`Order ${o.id} → ${sel.value}`, "success");
    }
    const setInp = e.target.closest("[data-set]");
    if (setInp) { setStock(setInp.dataset.set, Math.max(0, parseInt(setInp.value) || 0)); }
  });
  $("#adminContent").addEventListener("click", (e) => {
    const b = e.target.closest("[data-stock]");
    if (!b) return;
    const inv = getInv(); const it = inv.find(x => x.id === b.dataset.stock);
    it.stock = Math.max(0, it.stock + parseInt(b.dataset.d));
    save(K.inventory, inv); renderAdmin("inventory"); runLowStockCheck();
  });
  function setStock(id, val) {
    const inv = getInv(); const it = inv.find(x => x.id === id); it.stock = val; save(K.inventory, inv);
    renderAdmin("inventory"); runLowStockCheck();
  }

  /* ============ Low-stock check (node-cron style) ============ */
  function runLowStockCheck() {
    const inv = getInv();
    let notifs = getNotifs();
    let changed = false;
    inv.forEach(i => {
      const isLow = i.stock < i.threshold;
      // Avoid duplicate alerts for the same unchanged low condition
      const alreadyAlerted = notifs.some(n => n.item === i.itemName && n.active);
      if (isLow && !alreadyAlerted) {
        notifs.unshift({ id: uid("n_"), item: i.itemName, active: true, at: Date.now(),
          title: "Low Stock Alert", body: `${i.itemName} has fallen below its threshold (${i.stock}/${i.threshold}). [Email dispatched to admin]` });
        changed = true;
      }
      if (!isLow && alreadyAlerted) { notifs = notifs.map(n => n.item === i.itemName ? { ...n, active: false } : n); changed = true; }
    });
    if (changed) {
      notifs = notifs.slice(0, 30);
      save(K.notifs, notifs);
      const active = notifs.filter(n => n.active);
      if (active.length && getAdmin()) toast(`Low stock: ${active[0].item}`, "info");
      updateNotifDot();
      if (currentView === "admin" && currentAdminTab === "notifications") renderAdmin("notifications");
    }
  }
  function updateNotifDot() {
    const dot = $("#notifDot"); if (!dot) return;
    const active = getNotifs().filter(n => n.active).length;
    dot.innerHTML = active ? `<span style="background:var(--primary);color:#fff;font-size:.68rem;padding:1px 6px;border-radius:9px;margin-left:4px;">${active}</span>` : "";
  }
  // Scheduled job (simulates node-cron running periodically)
  setInterval(runLowStockCheck, 20000);

  /* ============ Init ============ */
  function init() {
    seedInventory();
    refreshAuthUI();
    updateNotifDot();
    runLowStockCheck();
    go("home");
  }
  init();
})();
