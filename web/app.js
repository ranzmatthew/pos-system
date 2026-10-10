import { createStockModule } from "./stock.js?v=20261009-untagged-1";
// Stock + POS. Offline-first. Supabase when keys are set, local demo otherwise.
// Phase 1: discounts, owner voids with stock return, cash shifts.
const $ = (id) => document.getElementById(id);
const peso = (c) => "₱" + ((c || 0) / 100).toFixed(2);
const toCents = (s) => Math.round(parseFloat(String(s).replace(/[^0-9.]/g, "")) * 100 || 0);
function normalizeProductCategory(value) {
  const category = String(value ?? "").trim();
  return !category || ["uncategorized", "n/a", "n/aa"].includes(category.toLocaleLowerCase()) ? "N/A" : category;
}
function normalizeCategoryColor(value) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : "#28594b"; }
function getCategoryColor(category) {
  const key = normalizeProductCategory(category).toLocaleLowerCase();
  return draftCategoryColors.get(key) || normalizeCategoryColor(LS.get("pos_products", []).find(product => normalizeProductCategory(product.category).toLocaleLowerCase() === key)?.category_color);
}
function categoryColorStyle(color) {
  color = normalizeCategoryColor(color);
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return "background:" + color + ";color:" + (luminance > .179 ? "#000000" : "#ffffff") + ";";
}
function getProductCategories(products) {
  const categories = new Map();
  for (const product of products) {
    const category = normalizeProductCategory(product.category);
    const key = category.toLocaleLowerCase();
    if (key !== "all" && !categories.has(key)) categories.set(key, category);
  }
  return [...categories.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
const uid = () => "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const uuid = () => globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });

const LS = {
  get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};

let session = LS.get("pos_session", null);
let cart = new Map();
let sb = null;
let posCategory = "All";
let discType = "none";
let editingProductId = null;
let editingProductStock = null;
let pendingDeleteProduct = null;
let pendingCartRemovalId = null;
let stockLimitWarningId = null;
let pendingVoidSaleId = null;
let pendingVoidReason = "";
let currentTotals = { subtotal: 0, discount: 0, total: 0 };

const DEMO_USERS = [
  { email: "owner@demo", password: "demo123", role: "owner" },
  { email: "staff@demo", password: "demo123", role: "staff" },
];

const DISC_RATE = { none: 0, senior: 0.2, pwd: 0.2, promo: 0.1 };
const DISC_LABEL = { none: "None", senior: "Senior 20%", pwd: "PWD 20%", promo: "Promo 10%" };
function calcDiscount(subtotal, type) {
  return Math.round(subtotal * (DISC_RATE[type] || 0));
}

function seed() {
  const catalog = [
    { sku: "1001", name: "Kopiko Brown", price_cents: 1500, cost_cents: 950, stock: 48 },
    { sku: "1002", name: "Pandesal (pc)", price_cents: 500, cost_cents: 250, stock: 100 },
    { sku: "1003", name: "Bottled Water", price_cents: 2000, cost_cents: 1100, stock: 36 },
    { sku: "1004", name: "Lucky Me Pancit", price_cents: 1800, cost_cents: 1200, stock: 4 },
    { sku: "2001", name: "Coca-Cola 330ml", price_cents: 2500, cost_cents: 1900, stock: 24 },
    { sku: "2002", name: "Sprite 330ml", price_cents: 2500, cost_cents: 1900, stock: 24 },
    { sku: "2003", name: "3-in-1 Coffee Sachet", price_cents: 1200, cost_cents: 800, stock: 50 },
    { sku: "2004", name: "Sardines 155g", price_cents: 2800, cost_cents: 2200, stock: 12 },
    { sku: "2005", name: "Corned Beef 150g", price_cents: 3800, cost_cents: 3200, stock: 12 },
    { sku: "2006", name: "Egg (pc)", price_cents: 1000, cost_cents: 800, stock: 30 },
    { sku: "2007", name: "Shampoo Sachet", price_cents: 700, cost_cents: 500, stock: 50 },
    { sku: "2008", name: "Laundry Detergent Sachet", price_cents: 800, cost_cents: 550, stock: 40 },
    { sku: "2009", name: "Potato Chips (small)", price_cents: 1500, cost_cents: 1000, stock: 24 },
    { sku: "2010", name: "SkyFlakes Crackers", price_cents: 1000, cost_cents: 700, stock: 24 },
  ];
  const storedProducts = LS.get("pos_products", null);
  const catalogSeeded = LS.get("pos_catalog_seed_v1", false);
  if (!storedProducts) {
    LS.set("pos_products", catalog.map(product => ({ ...product, id: uid() })));
  } else if (!catalogSeeded) {
    const existingSkus = new Set(storedProducts.map(product => product.sku).filter(Boolean));
    const additions = catalog
      .filter(product => !existingSkus.has(product.sku))
      .map(product => ({ ...product, id: uid() }));
    if (additions.length) LS.set("pos_products", [...storedProducts, ...additions]);
  }
  LS.set("pos_catalog_seed_v1", true);
  if (!LS.get("pos_reorder_level_v1", false)) {
    LS.set("pos_products", LS.get("pos_products", []).map(product => ({ ...product, reorder_level: Number.isInteger(product.reorder_level) ? product.reorder_level : 5 })));
    LS.set("pos_reorder_level_v1", true);
  }
  if (!LS.get("pos_sales", null)) LS.set("pos_sales", []);
  if (!LS.get("pos_outbox", null)) LS.set("pos_outbox", []);
  if (!LS.get("pos_shifts", null)) LS.set("pos_shifts", []);
}

async function connectSupabase() {
  const url = LS.get("sb_url", ""), key = LS.get("sb_key", "");
  sb = null;
  if (!url || !key) return false;
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    sb = createClient(url, key);
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      const { data: prof } = await sb.from("profiles").select("role").eq("id", data.session.user.id).single();
      session = { email: data.session.user.email, role: prof?.role || "staff", sbUser: data.session.user };
      LS.set("pos_session", { email: session.email, role: session.role });
    }
    $("sbMsg").textContent = "Online: connected to Supabase.";
    return true;
  } catch (e) {
    $("sbMsg").textContent = "Online failed, staying offline: " + e.message;
    sb = null;
    return false;
  }
}

async function sbLogin(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  let { data: prof } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
  if (!prof) {
    const role = email.toLowerCase().startsWith("owner") ? "owner" : "staff";
    await sb.from("profiles").insert({ id: data.user.id, email, role });
    prof = { role };
  }
  session = { email, role: prof.role, sbUser: data.user };
  LS.set("pos_session", { email, role: prof.role });
}

async function listProducts() {
  if (sb) {
    try {
      const { data, error } = await sb.from("products").select("*").order("name");
      if (error) throw error;
      const products = (data || []).map(p => ({ id: p.id, name: p.name, sku: p.sku, category: normalizeProductCategory(p.category), category_color: normalizeCategoryColor(p.category_color), price_cents: p.price_cents, cost_cents: p.cost_cents, stock: p.stock, reorder_level: p.reorder_level ?? 5 }));
      LS.set("pos_products", products);
      return products;
    } catch (error) {
      const cached = LS.get("pos_products", []);
      if (cached.length) return cached;
      throw error;
    }
  }
  return LS.get("pos_products", []).map(product => ({ ...product, category: normalizeProductCategory(product.category) }));
}

async function saveProduct(product) {
  if (session?.role !== "owner") throw new Error("Owner only.");
  if (sb) {
    if (product.id && String(product.id).startsWith("c_")) throw new Error("This device-only product cannot be edited online.");
    const { data, error } = await sb.rpc("save_pos_product", {
      p_product_id: product.id || null,
      p_name: product.name,
      p_sku: product.sku || null,
      p_price_cents: product.price_cents,
      p_cost_cents: product.cost_cents,
      p_stock: product.stock,
      p_reorder_level: product.reorder_level ?? 5,
      p_stock_reason: product.stock_reason || null,
      p_category: normalizeProductCategory(product.category),
      p_category_color: normalizeCategoryColor(product.category_color)
    });
    if (error) throw error;
    const saved = Array.isArray(data) ? data[0] : data;
    if (saved?.id) {
      const products = LS.get("pos_products", []);
      const index = products.findIndex(row => String(row.id) === String(saved.id));
      if (index < 0) products.push(saved); else products[index] = saved;
      LS.set("pos_products", products);
    }
    return saved;
  }
  return stockModule.saveLocalProduct(product);
}
async function deleteProduct(id) {
  if (session?.role !== "owner") throw new Error("Owner only.");
  if (sb) { const { error } = await sb.from("products").delete().eq("id", id); if (error) throw error; return; }
  LS.set("pos_products", LS.get("pos_products", []).filter(p => p.id !== id));
}

// ---------- Shifts ----------
function getOpenShift() {
  return LS.get("pos_shifts", []).find(s => s.status === "open") || null;
}
function shiftSalesTotal(openedAt) {
  const open = new Date(openedAt).getTime();
  return LS.get("pos_sales", [])
    .filter(s => s.status !== "voided" && new Date(s.created_at).getTime() >= open)
    .reduce((sum, s) => sum + s.total_cents, 0);
}
async function openShift(openCents) {
  if (getOpenShift()) throw new Error("A shift is already open. Close it first.");
  const shift = { id: uid(), opened_at: new Date().toISOString(), closed_at: null, open_cents: openCents, close_cents: null, expected_cents: null, diff_cents: null, status: "open", cashier: session?.email || "staff" };
  const list = LS.get("pos_shifts", []);
  list.unshift(shift);
  LS.set("pos_shifts", list);
  if (sb) {
    try {
      const { data } = await sb.from("shifts").insert({ opened_at: shift.opened_at, open_cents: openCents, status: "open", cashier_email: shift.cashier }).select("id").single();
      if (data?.id) {
        shift.remote_id = data.id;
        LS.set("pos_shifts", LS.get("pos_shifts", []).map(item => item.id === shift.id ? shift : item));
      }
    } catch {}
  }
  return shift;
}
async function closeShift(closeCents) {
  const open = getOpenShift();
  if (!open) throw new Error("No open shift.");
  const salesTotal = shiftSalesTotal(open.opened_at);
  const expected = open.open_cents + salesTotal;
  const diff = closeCents - expected;
  const list = LS.get("pos_shifts", []).map(s => s.id === open.id
    ? { ...s, closed_at: new Date().toISOString(), close_cents: closeCents, expected_cents: expected, diff_cents: diff, status: "closed" }
    : s);
  LS.set("pos_shifts", list);
  return { expected, diff };
}

// ---------- Sales ----------
async function charge(cashCents, paymentMethod = "cash") {
  const products = await listProducts();
  const lines = [...cart.entries()].map(([id, qty]) => ({ ...products.find(p => String(p.id) === String(id)), qty })).filter(x => x.name);
  if (!lines.length) throw new Error("Cart is empty.");
  for (const line of lines) if (line.qty > line.stock) throw new Error("Not enough stock: " + line.name + " (" + line.stock + " left).");
  if (sb && lines.some(line => String(line.id).startsWith("c_"))) throw new Error("A device-only product cannot be sold while connected. Recreate it online first.");
  const subtotal = lines.reduce((sum, line) => sum + line.price_cents * line.qty, 0);
  const discount = calcDiscount(subtotal, discType);
  const total = subtotal - discount;
  if (paymentMethod === "cash" && cashCents < total) throw new Error("Cash is short by " + peso(total - cashCents) + ".");
  const costTotal = lines.reduce((sum, line) => sum + line.cost_cents * line.qty, 0);
  const profit = total - costTotal;
  const open = getOpenShift();
  const sale = { id: uid(), client_id: uid(), subtotal_cents: subtotal, discount_type: discType, discount_cents: discount, total_cents: total, profit_cents: profit, payment: paymentMethod, status: "active", shift_id: open ? (open.remote_id || open.id) : null, created_at: new Date().toISOString(), lines };

  if (sb) {
    const payload = {
      ...sale,
      lines: lines.map(line => ({
        product_id: String(line.id).startsWith("c_") ? null : line.id,
        name: line.name, qty: line.qty, price_cents: line.price_cents, cost_cents: line.cost_cents
      }))
    };
    const { data, error } = await sb.rpc("complete_pos_sale", { p_sale: payload });
    if (error) queueOffline(sale, lines);
    else {
      const saved = Array.isArray(data) ? data[0] : data;
      if (saved?.sale_id) sale.id = saved.sale_id;
    }
  }
  if (!sb || LS.get("pos_outbox", []).some(row => row.client_id === sale.client_id)) {
    const sales = LS.get("pos_sales", []);
    sales.unshift({ ...sale, cashier: session?.email || "staff" });
    LS.set("pos_sales", sales);
    LS.set("pos_products", products.map(product => {
      const line = lines.find(item => String(item.id) === String(product.id));
      return line ? { ...product, stock: product.stock - line.qty } : product;
    }));
    stockModule.recordLocalSale(sale, lines);
  }
  const change = cashCents - total;
  const receipt = buildReceipt(sale, lines, cashCents, change);
  LS.set("pos_last_receipt", receipt);
  cart.clear();
  stockLimitWarningId = null;
  discType = "none";
  const discountSelect = $("discType");
  if (discountSelect) discountSelect.value = "none";
  return { sale, change, receipt };
}

function queueOffline(sale, lines) {
  const box = LS.get("pos_outbox", []);
  if (!box.some(item => item.client_id === sale.client_id)) {
    box.push({ ...sale, lines, cashier: session?.email || "staff" });
    LS.set("pos_outbox", box);
  }
}
async function syncNow() {
  if (!sb) return 0;
  const box = LS.get("pos_outbox", []);
  const remaining = [];
  let sent = 0;
  for (const sale of box) {
    const payload = {
      ...sale,
      lines: (sale.lines || []).map(line => ({
        product_id: line.product_id || (String(line.id || "").startsWith("c_") ? null : line.id),
        name: line.name, qty: line.qty, price_cents: line.price_cents, cost_cents: line.cost_cents
      }))
    };
    try {
      const { error } = await sb.rpc("complete_pos_sale", { p_sale: payload });
      if (error) throw error;
      stockModule.markSaleSynced(sale.client_id);
      sent += 1;
    } catch { remaining.push(sale); }
  }
  LS.set("pos_outbox", remaining);
  sent += await stockModule.syncPending().catch(() => 0);
  return sent;
}
async function voidSale(saleId, reason) {
  if (session?.role !== "owner") throw new Error("Owner only. Staff cannot void.");
  if (!reason) throw new Error("Give a reason (e.g. wrong item).");
  if (sb) {
    const { error } = await sb.rpc("void_pos_sale", { p_sale_id: saleId, p_reason: reason });
    if (error) throw error;
    const sales = LS.get("pos_sales", []);
    const cached = sales.find(item => item.id === saleId || item.client_id === saleId);
    if (cached) {
      cached.status = "voided";
      cached.void_reason = reason;
      cached.voided_at = new Date().toISOString();
      cached.voided_by = session?.email || "owner";
      LS.set("pos_sales", sales);
    }
    return;
  }
  const sales = LS.get("pos_sales", []);
  const sale = sales.find(item => item.id === saleId || item.client_id === saleId);
  if (!sale) throw new Error("Sale not found.");
  if (sale.status === "voided") throw new Error("Already voided.");
  sale.status = "voided";
  sale.void_reason = reason;
  sale.voided_at = new Date().toISOString();
  sale.voided_by = session?.email || "owner";
  LS.set("pos_sales", sales);
  const products = LS.get("pos_products", []);
  LS.set("pos_products", products.map(product => {
    const line = (sale.lines || []).find(item => String(item.id) === String(product.id) || item.name === product.name);
    return line ? { ...product, stock: product.stock + line.qty } : product;
  }));
  stockModule.recordLocalVoid(sale);
}
function buildReceipt(sale, lines, cash, change) {
  const w = 32;
  const line = "-".repeat(w);
  const row = (a, b) => a + " ".repeat(Math.max(1, w - a.length - b.length)) + b;
  let t = "      SARI-SARI STORE\n        SALES RECEIPT\n" + line + "\n";
  for (const l of lines) {
    t += l.name + " x" + l.qty + "\n" + row("", peso(l.price_cents * l.qty)) + "\n";
  }
  t += line + "\n" + row("SUBTOTAL", peso(sale.subtotal_cents ?? sale.total_cents)) + "\n";
  if ((sale.discount_cents || 0) > 0) {
    t += row("DISC (" + (DISC_LABEL[sale.discount_type] || sale.discount_type) + ")", "-" + peso(sale.discount_cents)) + "\n";
  }
  t += row("TOTAL", peso(sale.total_cents)) + "\n"
    + row(sale.payment === "online" ? "ONLINE PAYMENT" : "CASH", sale.payment === "online" ? "PAID" : peso(cash)) + "\n"
    + (sale.payment === "online" ? "" : row("CHANGE", peso(change)) + "\n") + line
    + "\n" + new Date(sale.created_at).toLocaleString() + "\nThank you!\n";
  return t;
}

// ---------- UI ----------
function normalizeModuleViews() {
  const mainScroll = $("mainScroll");
  for (const id of ["login", "pos", "inv", "dash", "shifts", "settings"]) {
    const view = $("view-" + id);
    if (view) mainScroll.appendChild(view);
  }
  const stockView = $("view-inv");
  const historyPanel = $("stockHistoryPanel");
  if (stockView && historyPanel && !stockView.contains(historyPanel)) {
    const movementModal = $("stockMovementModal");
    stockView.insertBefore(historyPanel, movementModal?.parentElement === stockView ? movementModal : null);
  }
}
normalizeModuleViews();
function show(view) {
  for (const v of ["login", "pos", "inv", "dash", "shifts", "settings"])
    $("view-" + v).classList.toggle("hidden", v !== view);
  document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  if (view === "pos") renderPOS();
  if (view === "inv") renderInv();
  if (view === "dash") renderDash().catch(error => { $("dashError").textContent = "Dashboard could not be loaded: " + error.message; $("dashError").classList.remove("hidden"); });
  if (view === "shifts") renderShifts();
}


function updateSidebarUser() {
  const metadata = session?.sbUser?.user_metadata || {};
  const displayName = metadata.full_name || metadata.name || session?.name || (session?.role === "owner" ? "Store owner" : "Staff user");
  $("sidebarUserName").textContent = session ? displayName : "Not signed in";
  $("sidebarUserEmail").textContent = session?.email || "";
  $("sidebarUserEmail").title = session?.email || "";
  $("sidebarLogoutBtn").classList.toggle("hidden", !session);
}

function gate() {
  updateSidebarUser();
  const role = session?.role || null;
  document.querySelectorAll("[data-view]").forEach(b => {
    const v = b.dataset.view;
    const allow = !!session && (role === "owner" ? true : (v === "pos" || v === "shifts" || v === "settings"));
    b.style.display = allow ? "" : "none";
  });
  if (!session) show("login");
  else show(role === "owner" ? "dash" : "pos");
}

function tickClock() {
  const el = $("clock");
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}


function animateProductToCart(tile) {
  const target = $("cartIconBtn");
  if (!target || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  const from = tile.getBoundingClientRect(), to = target.getBoundingClientRect();
  const flyer = document.createElement("span");
  flyer.className = "cart-fly-item";
  flyer.textContent = tile.querySelector(".t-name")?.textContent || "Added";
  flyer.style.left = (from.left + from.width / 2) + "px";
  flyer.style.top = (from.top + from.height / 2) + "px";
  document.body.appendChild(flyer);
  const removeFlyer = () => flyer.remove();
  flyer.addEventListener("transitionend", removeFlyer, { once: true });
  requestAnimationFrame(() => {
    flyer.style.left = (to.left + to.width / 2) + "px";
    flyer.style.top = (to.top + to.height / 2) + "px";
    flyer.style.opacity = "0";
    flyer.style.transform = "translate(-50%, -50%) scale(.35)";
  });
  setTimeout(removeFlyer, 700);
}

async function renderPOS() {
  const products = await listProducts().catch(() => []);
  const pending = LS.get("pos_outbox", []).length + (typeof stockModule === "undefined" ? 0 : stockModule.pendingCount());
  const label = sb ? (pending ? pending + " to send" : "online") : "offline";
  if ($("syncLabel")) $("syncLabel").textContent = label;
  const dot = $("syncDot");
  if (dot) dot.classList.toggle("on", !!sb && pending === 0);
  const open = getOpenShift();
  if ($("shiftBanner")) {
    $("shiftBanner").textContent = open
      ? "Shift open since " + new Date(open.opened_at).toLocaleTimeString() + " · started " + peso(open.open_cents) + "."
      : "No shift open. Sales still save, but cash tracking needs a shift.";
    $("shiftBanner").classList.toggle("warn", !open);
  }
  const categories = getProductCategories(products);
  const filterCategories = categories.filter(category => category !== "N/A");
  if (posCategory !== "All" && !filterCategories.some(category => category.toLocaleLowerCase() === posCategory.toLocaleLowerCase())) posCategory = "All";
  const categoryControls = $("posCategories");
  categoryControls.classList.toggle("hidden", products.length === 0);
  categoryControls.innerHTML = products.length
    ? ["All", ...filterCategories].map(category => "<button type=\"button\" class=\"pos-category-btn\"" + (category === "All" ? "" : ' style="' + categoryColorStyle(getCategoryColor(category)) + '"') + " data-pos-category=\"" + escapeHtml(category) + "\" aria-pressed=\"" + (posCategory.toLocaleLowerCase() === category.toLocaleLowerCase()) + "\">" + escapeHtml(category) + "</button>").join("")
    : "";
  categoryControls.querySelectorAll("[data-pos-category]").forEach(button => button.onclick = () => {
    posCategory = button.dataset.posCategory;
    renderPOS();
  });
  const filtered = posCategory === "All"
    ? products
    : products.filter(product => normalizeProductCategory(product.category).toLocaleLowerCase() === posCategory.toLocaleLowerCase());
  $("productList").innerHTML = filtered.map(p => {
    const low = p.stock <= 5;
    return "<button type=\"button\" class=\"tile" + (low ? " low" : "") + "\" data-add=\"" + p.id + "\"" + (p.stock <= 0 ? " disabled" : "") + ">"
      + "<span class=\"t-heading\"><span class=\"t-name\">" + escapeHtml(p.name) + "</span>"
      + (normalizeProductCategory(p.category) === "N/A" ? "" : '<span class="t-category" style="' + categoryColorStyle(getCategoryColor(p.category)) + '">' + escapeHtml(normalizeProductCategory(p.category)) + '</span>') + '</span>'
      + "<span class=\"t-stock" + (p.stock <= 5 ? " is-low" : "") + "\">" + (p.stock <= 0 ? "Out of stock" : Number(p.stock) + " in stock") + "</span>"
      + "<span class=\"t-price\">" + peso(p.price_cents) + "</span>"
      + "</button>";
  }).join("") || "<p class=\"mut\">No products in this category.</p>";
  document.querySelectorAll("[data-add]").forEach(b => b.onclick = () => {
    const id = b.dataset.add;
    const product = products.find(item => String(item.id) === String(id));
    const quantity = cart.get(id) || 0;
    if (!product || quantity >= Number(product.stock)) {
      stockLimitWarningId = id;
      renderCart();
      return;
    }
    stockLimitWarningId = null;
    animateProductToCart(b);
    cart.set(id, quantity + 1);
    renderCart();
  });
  renderCart();
}

async function renderCart() {
  const products = await listProducts().catch(() => []);
  const lines = [...cart.entries()].map(([id, qty]) => ({ ...products.find(p => String(p.id) === String(id)), qty })).filter(x => x.name);
  const subtotal = lines.reduce((s, l) => s + l.price_cents * l.qty, 0);
  const discount = calcDiscount(subtotal, discType);
  const total = subtotal - discount;
  currentTotals = { subtotal, discount, total };
  updateCashFeedback();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const cartBadge = $("cartCountBadge"), cartButton = $("cartIconBtn");
  if (cartBadge && cartButton) {
    cartBadge.textContent = count > 99 ? "99+" : String(count);
    cartBadge.classList.toggle("hidden", count === 0);
    cartButton.setAttribute("aria-label", count ? "Shopping cart, " + count + (count === 1 ? " item" : " items") : "Shopping cart");
    if (count > 0) {
      cartButton.classList.remove("cart-bump");
      void cartButton.offsetWidth;
      cartButton.classList.add("cart-bump");
    }
  }
  $("cartTotal").textContent = peso(total);
  $("summaryTotal").textContent = peso(total);
  $("summaryOrderCount").textContent = count + " item" + (count === 1 ? "" : "s");
  $("posSummary").classList.toggle("hidden", count === 0);
  if ($("subTotal")) $("subTotal").textContent = peso(subtotal);
  if ($("discLabel")) $("discLabel").textContent = "\u2212" + peso(discount);
  if ($("cartCount")) $("cartCount").textContent = count ? count + " item" + (count > 1 ? "s" : "") : "";
  $("cartList").innerHTML = lines.map(l => {
    const id = String(l.id), maxed = Number(l.qty) >= Number(l.stock);
    const warning = (stockLimitWarningId === id || maxed)
      ? '<small class="stock-limit-warning" role="status">Maximum stock reached Â· ' + Number(l.stock) + ' available</small>'
      : "";
    return '<div class="item"><div class="cart-line-copy"><b>' + escapeHtml(l.name) + '</b><div class="mut">' + peso(l.price_cents * l.qty) + '</div>' + warning + '</div>'
      + '<div class="qty"><button class="qty-decrease" data-dec="' + escapeHtml(id) + '" aria-label="Remove one ' + escapeHtml(l.name) + '">&#8722;</button><span>' + l.qty + '</span><button class="qty-increase" data-inc="' + escapeHtml(id) + '" aria-label="Add one ' + escapeHtml(l.name) + '">+</button></div></div>';
  }).join("") || '<p class="mut">Tap a product to add it.</p>';
  document.querySelectorAll("[data-dec]").forEach(button => button.onclick = () => {
    const id = button.dataset.dec, quantity = cart.get(id) || 0;
    if (quantity <= 1) {
      pendingCartRemovalId = id;
      $("cartRemoveProductName").textContent = lines.find(line => String(line.id) === id)?.name || "this item";
      $("cartRemoveModal").classList.remove("hidden");
      $("cancelCartRemovalBtn").focus();
      return;
    }
    if (stockLimitWarningId === id) stockLimitWarningId = null;
    cart.set(id, quantity - 1);
    renderCart();
  });
  document.querySelectorAll("[data-inc]").forEach(button => button.onclick = () => {
    const id = button.dataset.inc, line = lines.find(item => String(item.id) === id);
    const quantity = cart.get(id) || 0;
    if (line && quantity >= Number(line.stock)) {
      stockLimitWarningId = id;
      renderCart();
      return;
    }
    stockLimitWarningId = null;
    cart.set(id, quantity + 1);
    renderCart();
  });
}
let draftProductCategories = [];
let draftCategoryColors = new Map();
let activeCategoryIndex = -1;
let editingCategory = null;
let categorySaving = false;
function productCategoryChoices() {
  return getProductCategories([...LS.get("pos_products", []), ...draftProductCategories.map(category => ({ category }))]);
}
function closeCategoryDropdown() {
  $("productCategoryDropdown").classList.add("hidden");
  $("pCategory").setAttribute("aria-expanded", "false");
  $("categoryToggle").setAttribute("aria-expanded", "false");
  $("pCategory").removeAttribute("aria-activedescendant");
  activeCategoryIndex = -1;
}
function selectProductCategory(category, added = false) {
  $("pCategory").value = category;
  $("pCategoryFeedback").textContent = added ? "New category will be saved with this product." : "";
  closeCategoryDropdown();
  $("pCategory").focus();
}
function renderProductCategoryOptions(query = "", open = false) {
  const categories = productCategoryChoices();
  const term = query.trim().toLocaleLowerCase();
  const matches = categories.filter(category => category.toLocaleLowerCase().startsWith(term));
  $("productCategoryOptions").innerHTML = matches.length
    ? matches.map((category, index) => '<div class="category-option-row" role="presentation"><button type="button" class="category-edit" aria-label="Edit ' + escapeHtml(category) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6 12-12Z"/><path d="m14 5 5 5"/></svg></button><button type="button" class="category-option" role="option" id="productCategoryOption' + index + '" aria-selected="false"><span class="category-color-dot" style="background:' + getCategoryColor(category) + '" aria-hidden="true"></span>' + escapeHtml(category) + '</button></div>').join("")
    : '<p class="category-empty">No matching categories</p>';
  $("productCategoryOptions").querySelectorAll(".category-option").forEach((button, index) => {
    button.onclick = () => selectProductCategory(matches[index]);
  });
  $("productCategoryOptions").querySelectorAll(".category-edit").forEach((button, index) => {
    button.onclick = () => openCategoryEditor(matches[index]);
  });
  const canAdd = term && term !== "all" && !categories.some(category => category.toLocaleLowerCase() === term);
  $("addCategoryBtn").textContent = "Add " + query.trim();
  $("addCategoryBtn").classList.toggle("hidden", !canAdd);
  activeCategoryIndex = -1;
  $("pCategory").removeAttribute("aria-activedescendant");
  if (open) {
    $("productCategoryDropdown").classList.remove("hidden");
    $("pCategory").setAttribute("aria-expanded", "true");
    $("categoryToggle").setAttribute("aria-expanded", "true");
  } else closeCategoryDropdown();
}
function updateCategoryPreview() {
  $("categoryEditPreview").textContent = $("categoryEditName").value.trim() || "Category";
  $("categoryEditPreview").style.cssText = categoryColorStyle($("categoryEditColor").value);
}
function openCategoryEditor(category) {
  editingCategory = category;
  closeCategoryDropdown();
  $("categoryEditName").value = category;
  $("categoryEditColor").value = getCategoryColor(category);
  $("categoryEditError").classList.add("hidden");
  updateCategoryPreview();
  $("categoryEditorModal").classList.remove("hidden");
  $("categoryEditName").focus();
}
function closeCategoryEditor() {
  if (categorySaving) return;
  $("categoryEditorModal").classList.add("hidden");
  editingCategory = null;
  $("pCategory").focus();
}
async function saveCategoryEdits() {
  if (categorySaving || !editingCategory) return;
  const entered = $("categoryEditName").value.trim();
  const category = normalizeProductCategory(entered), color = $("categoryEditColor").value;
  const oldKey = editingCategory.toLocaleLowerCase(), newKey = category.toLocaleLowerCase();
  const errorNode = $("categoryEditError");
  errorNode.classList.add("hidden");
  categorySaving = true;
  $("categoryEditSave").disabled = $("categoryEditCancel").disabled = true;
  $("categoryEditName").disabled = $("categoryEditColor").disabled = true;
  try {
    if (session?.role !== "owner") throw new Error("Owner access required.");
    if (!entered || entered.length > 80) throw new Error("Enter a category name of up to 80 characters.");
    if (newKey === "all") throw new Error("All is reserved for the POS filter.");
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Choose a valid category color.");
    if (newKey !== oldKey && productCategoryChoices().some(item => item.toLocaleLowerCase() === newKey)) throw new Error("A category with that name already exists.");
    const products = LS.get("pos_products", []);
    if (sb && products.some(product => normalizeProductCategory(product.category).toLocaleLowerCase() === oldKey)) {
      const { error } = await sb.rpc("edit_pos_category", { p_old_category: editingCategory, p_new_category: category, p_color: color });
      if (error) throw error;
    }
    LS.set("pos_products", products.map(product => normalizeProductCategory(product.category).toLocaleLowerCase() === oldKey
      ? { ...product, category, category_color: normalizeCategoryColor(color) } : product));
    draftProductCategories = draftProductCategories.map(item => item.toLocaleLowerCase() === oldKey ? category : item);
    draftCategoryColors.delete(oldKey);
    draftCategoryColors.set(newKey, normalizeCategoryColor(color));
    if (normalizeProductCategory($("pCategory").value).toLocaleLowerCase() === oldKey) $("pCategory").value = category;
    if (posCategory.toLocaleLowerCase() === oldKey) posCategory = category;
    renderProductCategoryOptions();
  } catch (error) {
    errorNode.textContent = error.message || "Could not save category.";
    errorNode.classList.remove("hidden");
    return;
  } finally {
    categorySaving = false;
    $("categoryEditSave").disabled = $("categoryEditCancel").disabled = false;
    $("categoryEditName").disabled = $("categoryEditColor").disabled = false;
  }
  closeCategoryEditor();
  await Promise.all([renderPOS(), renderInv()]).catch(() => { $("pCategoryFeedback").textContent = "Category saved. Reopen Stock to refresh the list."; });
}
function resetProductForm() {
  editingProductId = null;
  editingProductStock = null;

  $("invModalTitle").textContent = "Add product";
  $("pSave").textContent = "Save";
  $("pName").value = $("pSku").value = $("pPrice").value = $("pCost").value = $("pStock").value = "";
  $("pReorder").value = "5";
  $("pCategory").value = "";
  $("pCategoryFeedback").textContent = "";
  draftProductCategories = [];
  draftCategoryColors = new Map();
  renderProductCategoryOptions();
}

function closeProductModal() {
  closeCategoryDropdown();
  $("invModal").classList.add("hidden");
}

function openDeleteProductModal(product) {
  pendingDeleteProduct = product;
  $("deleteProductName").textContent = product.name;
  $("deleteConfirmInput").value = "";
  $("confirmDeleteBtn").disabled = true;
  $("deleteProductModal").classList.remove("hidden");
  $("deleteConfirmInput").focus();
}

function closeDeleteProductModal() {
  $("deleteProductModal").classList.add("hidden");
  $("deleteConfirmInput").value = "";
  $("confirmDeleteBtn").disabled = true;
  $("confirmDeleteBtn").textContent = "Delete product";
  pendingDeleteProduct = null;
}

function openProductModal(product = null) {
  resetProductForm();
  if (product) {
    editingProductId = product.id;
    editingProductStock = Number(product.stock);

    $("invModalTitle").textContent = "Edit product";
    $("pSave").textContent = "Save";
    $("pName").value = product.name || "";
    const productCategory = normalizeProductCategory(product.category);
    $("pCategory").value = productCategory;
    $("pSku").value = product.sku || "";
    $("pPrice").value = (product.price_cents / 100).toFixed(2);
    $("pCost").value = (product.cost_cents / 100).toFixed(2);
    $("pStock").value = product.stock;
  
    $("pReorder").value = product.reorder_level ?? 5;
  }
  $("invModal").classList.remove("hidden");
  $("pName").focus();
}

async function renderInv() {
  return stockModule.render();
}
async function renderDash() {
  if (session?.role !== "owner") { show("pos"); return; }
  const errorNode = $("dashError"); errorNode.classList.add("hidden");
  const now = new Date(), dayStart = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayStart = dayStart(now), tomorrow = new Date(todayStart); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 6);
  const previousStart = new Date(weekStart); previousStart.setDate(previousStart.getDate() - 7);
  const open = getOpenShift(), rangeStart = open?.opened_at && new Date(open.opened_at) < previousStart ? new Date(open.opened_at) : previousStart;
  let sales = [], recentSales = [];
  if (sb) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await sb.from("sales").select("*").gte("created_at", rangeStart.toISOString()).lt("created_at", tomorrow.toISOString()).order("created_at", { ascending: false }).range(offset, offset + 499);
      if (error) throw error; sales.push(...(data || [])); if (!data || data.length < 500) break;
    }
    const { data, error } = await sb.from("sales").select("*").order("created_at", { ascending: false }).limit(10);
    if (error) throw error; recentSales = data || [];
  } else { sales = LS.get("pos_sales", []); recentSales = [...sales].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10); }
  const active = sales.filter(sale => sale.status !== "voided");
  const todays = active.filter(sale => { const date = new Date(sale.created_at); return date >= todayStart && date < tomorrow; });
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayTotal = active.filter(sale => { const date = new Date(sale.created_at); return date >= yesterdayStart && date < todayStart; }).reduce((sum, sale) => sum + (sale.total_cents || 0), 0);
  const todayTotal = todays.reduce((sum, sale) => sum + (sale.total_cents || 0), 0);
  const salesChange = $("todaySalesChange");
  if (yesterdayTotal === 0) {
    salesChange.textContent = "No sales yesterday";
    salesChange.className = "kpi-comparison is-flat";
  } else {
    const difference = todayTotal - yesterdayTotal;
    const percent = Math.round(difference / yesterdayTotal * 100);
    const amount = peso(Math.abs(difference));
    salesChange.textContent = difference > 0
      ? "↑ " + percent + "% · " + amount + " more than yesterday"
      : difference < 0
        ? "↓ " + Math.abs(percent) + "% · " + amount + " less than yesterday"
        : "Same as yesterday · 0%";
    salesChange.className = "kpi-comparison " + (difference > 0 ? "is-up" : difference < 0 ? "is-down" : "is-flat");
  }
  $("kSales").textContent = peso(todayTotal); $("kProfit").textContent = peso(todays.reduce((sum, sale) => sum + (sale.profit_cents || 0), 0));
  $("kAverage").textContent = peso(todays.length ? Math.round(todayTotal / todays.length) : 0);

  const products = await listProducts().catch(() => []);
  const restock = products.filter(product => product.stock <= (product.reorder_level ?? 5)).sort((a, b) => a.stock - b.stock);
  $("restockList").innerHTML = restock.length ? restock.slice(0, 5).map(product => "<div class=\"dash-list-row\"><div><b>" + escapeHtml(product.name) + "</b><div class=\"mut\">Alert at " + (product.reorder_level ?? 5) + " units</div></div><span class=\"stock-warning" + (Number(product.stock) <= 0 ? " is-out" : "") + "\">" + product.stock + " left</span></div>").join("") : "<p class=\"mut dash-empty\">All products are above their restock levels.</p>";

  const dates = [...Array(7)].map((_, index) => { const date = new Date(weekStart); date.setDate(date.getDate() + index); return date; });
  const amountForDay = day => { const next = new Date(day); next.setDate(next.getDate() + 1); return active.filter(sale => { const date = new Date(sale.created_at); return date >= day && date < next; }).reduce((sum, sale) => sum + (sale.total_cents || 0), 0); };
  const currentValues = dates.map(amountForDay), previousValues = dates.map(day => { const prior = new Date(day); prior.setDate(prior.getDate() - 7); return amountForDay(prior); });
  const max = Math.max(1, ...currentValues, ...previousValues);
  $("weeklySalesChart").innerHTML = dates.map((day, index) => {
    const prior = new Date(day); prior.setDate(prior.getDate() - 7);
    const height = value => Math.max(value ? 4 : 0, Math.round(value / max * 82));
    const aria = day.toLocaleDateString() + " sales " + peso(currentValues[index]) + "; previous week " + prior.toLocaleDateString() + " sales " + peso(previousValues[index]);
    const dateLabel = day.toLocaleDateString([], { month: "short", day: "numeric" });
    const bar = (period, value, className) => "<button type=\"button\" class=\"chart-bar " + className + "\" data-sales-period=\"" + period + "\" data-sales-date=\"" + dateLabel + "\" data-sales-value=\"" + peso(value) + "\" style=\"height:" + height(value) + "px\" title=\"" + period + ": " + peso(value) + "\" aria-label=\"" + period + " sales " + peso(value) + " on " + dateLabel + "\"></button>";
    return "<div class=\"chart-day\" role=\"listitem\" aria-label=\"" + escapeHtml(aria) + "\"><div class=\"chart-bars\">" + bar("Previous week", previousValues[index], "previous") + bar("This week", currentValues[index], "current") + "</div><span class=\"chart-day-label\">" + day.toLocaleDateString([], { weekday: "short" }) + "</span></div>";
  }).join("");
  document.querySelectorAll("[data-sales-period]").forEach(bar => bar.onclick = () => {
    const tooltip = $("chartTooltip");
    tooltip.textContent = bar.dataset.period + " · " + bar.dataset.date + ": " + bar.dataset.value;
    tooltip.classList.remove("hidden");
  });
  const currentSum = currentValues.reduce((a, b) => a + b, 0), priorSum = previousValues.reduce((a, b) => a + b, 0);
  const change = priorSum ? Math.round((currentSum - priorSum) / priorSum * 100) : null;
  $("weeklyCurrentSummary").textContent = "This week " + peso(currentSum);
  $("weeklyPreviousSummary").textContent = "Previous week " + peso(priorSum);
  $("weeklyComparison").textContent = change == null ? "" : (change > 0 ? "+" : "") + change + "%";

  let items = [];
  const weekSales = active.filter(sale => new Date(sale.created_at) >= weekStart);
  if (sb) {
    const ids = weekSales.map(sale => sale.id).filter(Boolean);
    for (let offset = 0; offset < ids.length; offset += 100) {
      const { data, error } = await sb.from("sale_items").select("name,qty,price_cents,sale_id").in("sale_id", ids.slice(offset, offset + 100));
      if (error) { errorNode.textContent = "Best sellers could not be loaded: " + error.message; errorNode.classList.remove("hidden"); break; }
      items.push(...(data || []));
    }
  } else items = weekSales.flatMap(sale => sale.lines || []);
  const grouped = new Map();
  for (const item of items) { const name = item.name || "Product", entry = grouped.get(name) || { name, qty: 0, revenue: 0 }; entry.qty += item.qty || 0; entry.revenue += (item.price_cents || 0) * (item.qty || 0); grouped.set(name, entry); }
  const leaders = [...grouped.values()].sort((a, b) => b.qty - a.qty).slice(0, 5), leaderMax = leaders[0]?.qty || 1;
  $("bestSellerList").innerHTML = leaders.length ? leaders.map((item, index) => "<div class=\"best-seller-row\"><div class=\"best-seller-top\"><b><span class=\"rank\">" + (index + 1) + "</span>" + escapeHtml(item.name) + "</b><span>" + item.qty + " sold</span></div><div class=\"best-seller-track\"><i style=\"width:" + Math.round(item.qty / leaderMax * 100) + "%\"></i></div><div class=\"mut\">" + peso(item.revenue) + " sales</div></div>").join("") : "<p class=\"mut dash-empty\">No sales in the last 7 days.</p>";

  if (open) {
    const shiftSales = active.filter(sale => open.remote_id ? sale.shift_id === open.remote_id : new Date(sale.created_at) >= new Date(open.opened_at)).reduce((sum, sale) => sum + (sale.total_cents || 0), 0);
    $("shiftSnapshot").innerHTML = "<div class=\"shift-snapshot-grid\"><div><span class=\"mut\">Started</span><b>" + new Date(open.opened_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "</b></div><div><span class=\"mut\">Opening cash</span><b>" + peso(open.open_cents) + "</b></div><div><span class=\"mut\">Sales this shift</span><b>" + peso(shiftSales) + "</b></div><div><span class=\"mut\">Expected drawer</span><b>" + peso((open.open_cents || 0) + shiftSales) + "</b></div></div>";
  } else { $("shiftSnapshot").innerHTML = "<p class=\"mut\">No shift is open right now.</p><button id=\"openShiftFromDash\" class=\"ghost dashboard-link\" type=\"button\">Open a shift</button>"; $("openShiftFromDash").onclick = () => show("shifts"); }

  $("saleList").innerHTML = recentSales.map(sale => { const voided = sale.status === "voided", disc = (sale.discount_cents || 0) > 0 ? " · disc " + peso(sale.discount_cents) : ""; return "<div class=\"item\"><div><b>" + peso(sale.total_cents) + "</b>" + (voided ? " <span class=\"void-badge\">VOID</span>" : "") + "<div class=\"mut\">" + new Date(sale.created_at).toLocaleString() + " · profit " + peso(sale.profit_cents || 0) + disc + (voided ? " · " + escapeHtml(sale.void_reason || "voided") : "") + "</div></div>" + (voided ? "" : "<button class=\"danger\" data-void=\"" + (sale.id || sale.client_id) + "\">Void</button>") + "</div>"; }).join("") || "<p class=\"mut\">No sales yet.</p>";
  document.querySelectorAll("[data-void]").forEach(button => button.onclick = () => openVoidReasonModal(button.dataset.void));
}

function openVoidReasonModal(saleId) {
  pendingVoidSaleId = saleId;
  pendingVoidReason = "";
  $("voidReasonInput").value = "";
  $("voidReasonError").classList.add("hidden");
  $("voidReasonModal").classList.remove("hidden");
  $("voidReasonInput").focus();
}

function closeVoidReasonModal() {
  $("voidReasonModal").classList.add("hidden");
  $("voidReasonError").classList.add("hidden");
  if (!$("confirmVoidModal").classList.contains("hidden")) return;
  pendingVoidSaleId = null;
  pendingVoidReason = "";
}

function continueVoidConfirmation() {
  pendingVoidReason = $("voidReasonInput").value.trim();
  if (!pendingVoidReason) {
    $("voidReasonError").classList.remove("hidden");
    $("voidReasonInput").focus();
    return;
  }
  $("voidReasonError").classList.add("hidden");
  $("confirmVoidReason").textContent = pendingVoidReason;
  $("voidReasonModal").classList.add("hidden");
  $("confirmVoidModal").classList.remove("hidden");
  $("confirmVoidBtn").focus();
}

async function confirmVoidSale() {
  if (!pendingVoidSaleId || !pendingVoidReason) return;
  const button = $("confirmVoidBtn");
  button.disabled = true;
  button.textContent = "Voiding…";
  try {
    await voidSale(pendingVoidSaleId, pendingVoidReason);
    $("confirmVoidModal").classList.add("hidden");
    pendingVoidSaleId = null;
    pendingVoidReason = "";
    button.disabled = false;
    button.textContent = "Void sale";
    await renderDash();
    renderPOS();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = "Void sale";
  }
}

function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
const stockModule = createStockModule({
  $, LS, getSupabase: () => sb, getSession: () => session, listProducts, peso, escapeHtml, uuid,
  openProductModal, openDeleteProductModal
});function renderShifts() {
  const list = LS.get("pos_shifts", []);
  const open = getOpenShift();
  if ($("shiftInfo")) {
    if (open) {
      const running = shiftSalesTotal(open.opened_at);
      $("shiftInfo").innerHTML = "<div class=\"shift-open\">Open since " + new Date(open.opened_at).toLocaleString()
        + " · started " + peso(open.open_cents) + " · sales so far " + peso(running)
        + " · expected in drawer " + peso(open.open_cents + running) + ".</div>";
    } else {
      $("shiftInfo").innerHTML = "<p class=\"mut\">No shift open.</p>";
    }
  }
  if ($("shiftList")) {
    $("shiftList").innerHTML = list.map(s => {
      if (s.status === "open") return "<div class=\"item\"><div><b>Open · " + peso(s.open_cents) + "</b><div class=\"mut\">Started " + new Date(s.opened_at).toLocaleString() + " · " + (s.cashier || "") + "</div></div></div>";
      const diffTxt = s.diff_cents == null ? "" : (s.diff_cents === 0 ? " · exact" : " · " + (s.diff_cents > 0 ? "over " : "short ") + peso(Math.abs(s.diff_cents)));
      return "<div class=\"item\"><div><b>" + peso(s.expected_cents || 0) + " expected</b><div class=\"mut\">Closed " + (s.closed_at ? new Date(s.closed_at).toLocaleString() : "") + " · counted " + peso(s.close_cents || 0) + diffTxt + "</div></div></div>";
    }).join("") || "<p class=\"mut\">No shifts yet.</p>";
  }
}

// ---------- Side navbar: toggle + swipe left to hide ----------
function openNav() { document.body.classList.remove("nav-hidden"); $("scrim")?.classList.remove("hidden"); }
function closeNav() { document.body.classList.add("nav-hidden"); $("scrim")?.classList.add("hidden"); }
function closeNavOnMobile() { if (window.innerWidth < 900) closeNav(); }
function refreshIcons() { try { window.lucide?.createIcons(); } catch {} }
$("menuBtn").onclick = () => (document.body.classList.contains("nav-hidden") ? openNav() : closeNav());
$("scrim").onclick = () => closeNav();
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNavOnMobile(); });
let tx0 = null, ty0 = null;
document.addEventListener("touchstart", (e) => {
  const t = e.touches[0]; tx0 = t.clientX; ty0 = t.clientY;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (tx0 == null) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - tx0, dy = t.clientY - ty0;
  tx0 = null;
  if (Math.abs(dx) < 48 || Math.abs(dy) > 60) return;
  const navOpen = !document.body.classList.contains("nav-hidden");
  if (dx < 0 && navOpen) closeNav();
  else if (dx > 0 && !navOpen && t.clientX < 40) openNav();
}, { passive: true });
if (window.innerWidth < 900) closeNav(); else openNav();
refreshIcons();

// ---------- Events ----------
document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { show(b.dataset.view); closeNavOnMobile(); });
function animateSelection(element) {
  if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove("selection-pulse");
  void element.offsetWidth;
  element.classList.add("selection-pulse");
}
document.addEventListener("click", event => {
  const control = event.target.closest("button, .tile, [role='tab'], .chart-bar");
  if (control && !control.disabled) animateSelection(control);
});
document.addEventListener("change", event => {
  if (event.target instanceof HTMLSelectElement) animateSelection(event.target);
});
document.addEventListener("animationend", event => {
  if (event.target.classList?.contains("selection-pulse")) event.target.classList.remove("selection-pulse");
});
$("loginBtn").onclick = async () => {
  const email = $("email").value.trim(), password = $("password").value;
  try {
    if (sb) await sbLogin(email, password);
    else {
      const u = DEMO_USERS.find(u => u.email === email && u.password === password);
      if (!u) throw new Error("Wrong demo login. Try owner@demo / demo123.");
      session = { email: u.email, role: u.role };
      LS.set("pos_session", session);
    }
    $("authMsg").textContent = "";
    gate();
  } catch (e) { $("authMsg").textContent = e.message; }
};
$("logoutBtn").onclick = async () => {
  if (sb) await sb.auth.signOut();
  session = null; localStorage.removeItem("pos_session"); gate();
};
$("sidebarLogoutBtn").onclick = () => $("logoutBtn").click();
$("checkoutBtn").onclick = () => {
  if (!cart.size) return;
  $("changeLabel").textContent = "";
  resetCheckoutSwipe();
  updateCashFeedback();
  $("checkoutOverlay").classList.remove("hidden");
  setCheckoutExpanded(false);
  $("cash").focus();
};
$("cartIconBtn").onclick = () => $("checkoutBtn").click();
$("checkoutOverlay").onclick = (event) => {
  if (event.target === $("checkoutOverlay")) { $("checkoutOverlay").classList.add("hidden"); setCheckoutExpanded(false); }
};
const checkoutSheet = document.querySelector(".checkout-sheet");
const checkoutClearButton = $("checkoutExpandBtn");
function setCheckoutExpanded(expanded) {
  checkoutSheet.classList.toggle("expanded", expanded);
  $("sheetGrabber").setAttribute("aria-expanded", String(expanded));
}
checkoutClearButton.onclick = () => {
  if (paymentInProgress) return;
  cart.clear();
  stockLimitWarningId = null;
  discType = "none";
  if ($("discType")) $("discType").value = "none";
  $("cash").value = $("changeLabel").textContent = "";
  resetCheckoutSwipe();
  renderCart();
  $("checkoutOverlay").classList.add("hidden");
  setCheckoutExpanded(false);
  $("cartIconBtn").focus();
};
$("sheetGrabber").onkeydown = event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  setCheckoutExpanded(!checkoutSheet.classList.contains("expanded"));
};
let sheetSwipeStart = null;
checkoutSheet.onpointerdown = (event) => {
  if (!event.isPrimary || event.button !== 0 || event.target.closest("button, input") || paymentInProgress) return;
  if (!event.target.closest(".sheet-grabber, .checkout-head") && event.target !== checkoutSheet) return;
  sheetSwipeStart = { y: event.clientY, height: checkoutSheet.getBoundingClientRect().height,
    expanded: checkoutSheet.classList.contains("expanded"), pointerId: event.pointerId };
  checkoutSheet.setPointerCapture(event.pointerId);
};
checkoutSheet.onpointermove = event => {
  if (!sheetSwipeStart || event.pointerId !== sheetSwipeStart.pointerId) return;
  const distance = sheetSwipeStart.y - event.clientY;
  if (Math.abs(distance) < 5) return;
  checkoutSheet.classList.add("dragging");
  if (distance > 0) setCheckoutExpanded(true);
  const maxHeight = window.innerWidth < 900 ? window.innerHeight - 12 : window.innerHeight * .86;
  checkoutSheet.style.height = Math.max(Math.min(300, sheetSwipeStart.height), Math.min(maxHeight, sheetSwipeStart.height + distance)) + "px";
};
checkoutSheet.onpointerup = (event) => {
  if (!sheetSwipeStart || event.pointerId !== sheetSwipeStart.pointerId) return;
  const initial = sheetSwipeStart;
  sheetSwipeStart = null;
  const distance = event.clientY - initial.y;
  checkoutSheet.style.removeProperty("height");
  checkoutSheet.classList.remove("dragging");
  setCheckoutExpanded(initial.expanded);
  if (distance < -45) setCheckoutExpanded(true);
  if (distance > 45) {
    if (initial.expanded) setCheckoutExpanded(false);
    else $("checkoutOverlay").classList.add("hidden");
  }
  checkoutSheet.releasePointerCapture(event.pointerId);
};
checkoutSheet.onpointercancel = checkoutSheet.onlostpointercapture = () => {
  if (!sheetSwipeStart) return;
  setCheckoutExpanded(sheetSwipeStart.expanded);
  sheetSwipeStart = null;
  checkoutSheet.style.removeProperty("height");
  checkoutSheet.classList.remove("dragging");
};
const closeCartRemovalModal = () => {
  $("cartRemoveModal").classList.add("hidden");
  pendingCartRemovalId = null;
};
$("cancelCartRemovalBtn").onclick = closeCartRemovalModal;
$("confirmCartRemovalBtn").onclick = () => {
  if (pendingCartRemovalId) cart.delete(pendingCartRemovalId);
  closeCartRemovalModal();
  renderCart();
};
$("cartRemoveModal").onclick = (event) => {
  if (event.target === $("cartRemoveModal")) closeCartRemovalModal();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("cartRemoveModal").classList.contains("hidden")) closeCartRemovalModal();
});
const closeCashShortModal = () => {
  $("cashShortModal").classList.add("hidden");
  $("cash").focus();
};
$("addCashBtn").onclick = closeCashShortModal;
$("cashShortModal").onclick = (event) => {
  if (event.target === $("cashShortModal")) closeCashShortModal();
};
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("cashShortModal").classList.contains("hidden")) closeCashShortModal();
});
const cashSuccessData = fetch("./assets/success.json", { signal: AbortSignal.timeout(4000) }).then(response => {
  if (!response.ok) throw new Error("Animation unavailable");
  return response.json();
}).catch(() => null);
let paymentInProgress = false;
async function showCashSuccess(change) {
  const overlay = $("cashSuccessOverlay"), container = $("cashSuccessAnimation"), fallback = $("cashSuccessFallback");
  $("cashSuccessChange").textContent = change > 0 ? "Change due: " + peso(change) : "Exact amount. No change.";
  container.replaceChildren();
  fallback.classList.remove("hidden");
  overlay.classList.remove("hidden");
  overlay.querySelector(".cash-success-card").focus();
  let animation;
  try {
    const data = await cashSuccessData;
    if (data && window.lottie && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animation = window.lottie.loadAnimation({ container, renderer: "svg", loop: false, autoplay: false,
        animationData: structuredClone(data) });
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timeout); resolve(); };
        const timeout = setTimeout(finish, 2200);
        animation.addEventListener("DOMLoaded", () => {
          fallback.classList.add("hidden");
          animation.play();
        });
        animation.addEventListener("complete", finish);
        animation.addEventListener("data_failed", finish);
      });
    } else await new Promise(resolve => setTimeout(resolve, 1500));
  } catch {
    await new Promise(resolve => setTimeout(resolve, 1500));
  } finally {
    animation?.destroy();
    container.replaceChildren();
    overlay.classList.add("hidden");
    $("cartIconBtn").focus();
  }
}
async function completePayment(paymentMethod) {
  if (paymentInProgress) return;
  paymentInProgress = true;
  $("cashPaymentBtn").disabled = $("onlinePaymentBtn").disabled = $("cancelPaymentMethodBtn").disabled = true;
  try {
    const cash = paymentMethod === "cash" ? toCents($("cash").value) : currentTotals.total;
    const { change, receipt } = await charge(cash, paymentMethod);
    $("receiptText").textContent = receipt;
    $("changeLabel").textContent = "";
    $("cash").value = "";
    updateCashFeedback();
    $("paymentMethodModal").classList.add("hidden");
    resetCheckoutSwipe();
    if (sb) syncNow().then(renderPOS);
    $("checkoutOverlay").classList.add("hidden");
    await renderPOS();
    if (paymentMethod === "cash") await showCashSuccess(change);
    else window.print();
  } catch (e) {
    $("paymentMethodModal").classList.add("hidden");
    resetCheckoutSwipe();
    if (e.message.startsWith("Cash is short by")) {
      $("cashShortMessage").textContent = e.message;
      $("cashShortModal").classList.remove("hidden");
      $("addCashBtn").focus();
    } else alert(e.message);
  } finally {
    paymentInProgress = false;
    $("cashPaymentBtn").disabled = $("onlinePaymentBtn").disabled = $("cancelPaymentMethodBtn").disabled = false;
  }
}
const checkoutSwipe = $("paySwipe");
const checkoutSwipeArrow = $("payBtn");
let checkoutDrag = null;
let checkoutSwipeConfirmed = false;
function setCheckoutSwipeOffset(offset, completed = false) {
  checkoutSwipe.style.setProperty("--swipe-offset", offset + "px");
  checkoutSwipe.style.setProperty("--swipe-fill", completed ? "100%" : (offset ? offset + 56 + "px" : "0px"));
}
function resetCheckoutSwipe() {
  checkoutDrag = null;
  checkoutSwipeConfirmed = false;
  checkoutSwipe.classList.remove("dragging", "confirmed");
  checkoutSwipeArrow.disabled = toCents($("cash").value) <= 0 || !cart.size;
  checkoutSwipe.classList.toggle("unavailable", checkoutSwipeArrow.disabled);
  setCheckoutSwipeOffset(0);
}
function confirmCheckoutSwipe() {
  if (checkoutSwipeConfirmed || !cart.size || toCents($("cash").value) <= 0) return;
  checkoutSwipeConfirmed = true;
  checkoutDrag = null;
  checkoutSwipe.classList.remove("dragging");
  checkoutSwipe.classList.add("confirmed");
  setCheckoutSwipeOffset(Math.max(0, checkoutSwipe.clientWidth - checkoutSwipeArrow.offsetWidth - 6), true);
  checkoutSwipeArrow.disabled = true;
  $("paymentMethodModal").classList.remove("hidden");
  $("cashPaymentBtn").focus();
}
checkoutSwipeArrow.onpointerdown = event => {
  if (!event.isPrimary || event.button !== 0 || checkoutSwipeConfirmed || checkoutSwipeArrow.disabled || toCents($("cash").value) <= 0) return;
  const travel = checkoutSwipe.clientWidth - checkoutSwipeArrow.offsetWidth - 6;
  if (travel <= 0) return;
  checkoutDrag = { pointerId: event.pointerId, startX: event.clientX, travel, offset: 0 };
  checkoutSwipe.classList.add("dragging");
  checkoutSwipeArrow.setPointerCapture(event.pointerId);
};
checkoutSwipeArrow.onpointermove = event => {
  if (!checkoutDrag || event.pointerId !== checkoutDrag.pointerId) return;
  checkoutDrag.offset = Math.max(0, Math.min(checkoutDrag.travel, event.clientX - checkoutDrag.startX));
  setCheckoutSwipeOffset(checkoutDrag.offset);
};
checkoutSwipeArrow.onpointerup = event => {
  if (!checkoutDrag || event.pointerId !== checkoutDrag.pointerId) return;
  const completed = Math.max(0, event.clientX - checkoutDrag.startX) >= checkoutDrag.travel - 8;
  checkoutDrag = null;
  checkoutSwipeArrow.releasePointerCapture(event.pointerId);
  if (completed) confirmCheckoutSwipe();
  else resetCheckoutSwipe();
};
checkoutSwipeArrow.onpointercancel = checkoutSwipeArrow.onlostpointercapture = () => {
  if (checkoutDrag) resetCheckoutSwipe();
};
checkoutSwipeArrow.onclick = event => {
  if (event.detail === 0) confirmCheckoutSwipe();
};
function closePaymentMethod() {
  if (paymentInProgress) return;
  $("paymentMethodModal").classList.add("hidden");
  resetCheckoutSwipe();
  checkoutSwipeArrow.focus();
}
$("cashPaymentBtn").onclick = () => completePayment("cash");
$("onlinePaymentBtn").onclick = () => completePayment("online");
$("cancelPaymentMethodBtn").onclick = closePaymentMethod;
$("paymentMethodModal").onclick = event => {
  if (event.target === $("paymentMethodModal")) closePaymentMethod();
};
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("paymentMethodModal").classList.contains("hidden")) closePaymentMethod();
});

function updateCashFeedback() {
  const input = $("cash"), feedback = $("cashFeedback");
  const hasAmount = /\d/.test(input.value);
  const shortage = currentTotals.total - toCents(input.value);
  const insufficient = hasAmount && shortage > 0;
  input.setAttribute("aria-invalid", String(insufficient));
  feedback.textContent = insufficient ? "Cash is short by " + peso(shortage) + "." : "";
  feedback.classList.toggle("hidden", !insufficient);
  if (toCents(input.value) <= 0 && checkoutDrag) resetCheckoutSwipe();
  checkoutSwipeArrow.disabled = checkoutSwipeConfirmed || toCents(input.value) <= 0 || !cart.size;
  checkoutSwipe.classList.toggle("unavailable", !checkoutSwipeConfirmed && checkoutSwipeArrow.disabled);
}
$("cash").oninput = () => {
  const input = $("cash"), cursor = input.selectionStart;
  const beforeCursor = input.value.slice(0, cursor).replace(/[^0-9.]/g, "").length;
  const parts = input.value.replace(/[^0-9.]/g, "").split(".");
  const amount = parts[0] + (parts.length > 1 ? "." + parts.slice(1).join("").slice(0, 2) : "");
  input.value = amount ? "\u20b1" + amount : "";
  const nextCursor = Math.min(input.value.length, beforeCursor + (amount ? 1 : 0));
  input.setSelectionRange(nextCursor, nextCursor);
  updateCashFeedback();
};
$("pCategory").onclick = () => renderProductCategoryOptions("", true);
$("categoryEditName").oninput = $("categoryEditColor").oninput = updateCategoryPreview;
$("categoryEditSave").onclick = saveCategoryEdits;
$("categoryEditCancel").onclick = closeCategoryEditor;
$("categoryEditorModal").onclick = event => { if (event.target === $("categoryEditorModal")) closeCategoryEditor(); };
$("pCategory").oninput = () => {
  $("pCategoryFeedback").textContent = "";
  renderProductCategoryOptions($("pCategory").value, true);
};
$("categoryToggle").onclick = () => {
  if (!$("productCategoryDropdown").classList.contains("hidden")) closeCategoryDropdown();
  else { renderProductCategoryOptions("", true); $("pCategory").focus(); }
};
$("addCategoryBtn").onclick = () => {
  const category = $("pCategory").value.trim();
  if (!category || category.toLocaleLowerCase() === "all") return;
  const existing = productCategoryChoices().find(item => item.toLocaleLowerCase() === category.toLocaleLowerCase());
  if (!existing) draftProductCategories.push(category);
  selectProductCategory(existing || category, !existing);
};
$("pCategory").onkeydown = event => {
  if (event.key === "Escape" && !$("productCategoryDropdown").classList.contains("hidden")) {
    event.stopPropagation(); closeCategoryDropdown(); return;
  }
  if (event.key === "Tab") { closeCategoryDropdown(); return; }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
  if (event.key === "Enter") {
    if ($("productCategoryDropdown").classList.contains("hidden")) return;
    event.preventDefault();
    const options = $("productCategoryOptions").querySelectorAll(".category-option");
    if (options[activeCategoryIndex]) options[activeCategoryIndex].click();
    else if (!$("addCategoryBtn").classList.contains("hidden")) $("addCategoryBtn").click();
    return;
  }
  event.preventDefault();
  if ($("productCategoryDropdown").classList.contains("hidden")) renderProductCategoryOptions("", true);
  const options = $("productCategoryOptions").querySelectorAll(".category-option");
  if (!options.length) return;
  activeCategoryIndex = (activeCategoryIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options.forEach((option, index) => option.setAttribute("aria-selected", String(index === activeCategoryIndex)));
  $("pCategory").setAttribute("aria-activedescendant", options[activeCategoryIndex].id);
  options[activeCategoryIndex].scrollIntoView({ block: "nearest" });
};
document.addEventListener("click", event => {
  if (!event.target.closest(".category-picker")) closeCategoryDropdown();
});
$("addProductBtn").onclick = () => openProductModal();

$("cancelProductBtn").onclick = closeProductModal;

$("cancelVoidReasonBtn").onclick = closeVoidReasonModal;
$("continueVoidBtn").onclick = continueVoidConfirmation;
$("cancelVoidConfirmBtn").onclick = () => {
  $("confirmVoidModal").classList.add("hidden");
  $("voidReasonModal").classList.remove("hidden");
  $("voidReasonInput").focus();
};
$("confirmVoidBtn").onclick = confirmVoidSale;
$("invModal").onclick = (event) => { if (event.target === $("invModal")) closeProductModal(); };
document.addEventListener("click", (event) => {
  if (!event.target.closest(".inv-menu-wrap")) {
    document.querySelectorAll(".inv-menu").forEach(menu => menu.classList.add("hidden"));
    document.querySelectorAll("[data-menu]").forEach(button => button.setAttribute("aria-expanded", "false"));
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("categoryEditorModal").classList.contains("hidden")) { closeCategoryEditor(); return; }
  if (event.key === "Escape" && !$("invModal").classList.contains("hidden")) closeProductModal();
  if (event.key === "Escape" && !$("deleteProductModal").classList.contains("hidden")) closeDeleteProductModal();
});
$("deleteConfirmInput").oninput = () => {
  $("confirmDeleteBtn").disabled = !pendingDeleteProduct || $("deleteConfirmInput").value.trim() !== pendingDeleteProduct.name.trim();
};
$("cancelDeleteBtn").onclick = closeDeleteProductModal;
$("deleteProductModal").onclick = (event) => {
  if (event.target === $("deleteProductModal")) closeDeleteProductModal();
};
$("confirmDeleteBtn").onclick = async () => {
  if (!pendingDeleteProduct || $("deleteConfirmInput").value.trim() !== pendingDeleteProduct.name.trim()) return;
  const productId = pendingDeleteProduct.id;
  $("confirmDeleteBtn").disabled = true;
  $("confirmDeleteBtn").textContent = "Deleting...";
  try {
    await deleteProduct(productId);
    closeDeleteProductModal();
    await renderInv();
  } catch (e) {
    alert(e.message);
    $("confirmDeleteBtn").textContent = "Delete product";
    $("confirmDeleteBtn").disabled = $("deleteConfirmInput").value.trim() !== pendingDeleteProduct?.name.trim();
  }
};
$("pSave").onclick = async () => {
  const name = $("pName").value.trim();
  if (!name) { $("pName").focus(); return; }
  const enteredCategory = normalizeProductCategory($("pCategory").value);
  const category = getProductCategories(LS.get("pos_products", [])).find(existing => existing.toLocaleLowerCase() === enteredCategory.toLocaleLowerCase()) || enteredCategory;
  if (category.toLocaleLowerCase() === "all") {
    alert("All is reserved for the POS category filter.");
    $("pCategory").focus();
    return;
  }
  try {
    await saveProduct({
      id: editingProductId,
      category,
      category_color: getCategoryColor(category),
      name,
      sku: $("pSku").value.trim(),
      price_cents: toCents($("pPrice").value),
      cost_cents: toCents($("pCost").value),
      stock: parseInt($("pStock").value || "0", 10),
      reorder_level: Math.max(0, parseInt($("pReorder").value || "5", 10)),
      stock_reason: editingProductId && parseInt($("pStock").value || "0", 10) !== editingProductStock ? "Stock quantity updated from product form" : "",
    });
    closeProductModal();
    resetProductForm();
    await renderInv();
    await renderPOS();
  } catch (e) { alert(e.message); }
};
$("manageStockBtn").onclick = () => { stockModule.setTab("products"); show("inv"); };
$("shiftOpenBtn").onclick = async () => {
  try {
    await openShift(toCents($("shiftOpen").value));
    $("shiftOpen").value = "";
    $("shiftMsg").textContent = "Shift opened.";
    renderShifts(); renderPOS();
  } catch (e) { $("shiftMsg").textContent = e.message; }
};
$("shiftCloseBtn").onclick = async () => {
  try {
    const { expected, diff } = await closeShift(toCents($("shiftClose").value));
    $("shiftClose").value = "";
    $("shiftMsg").textContent = "Closed. Expected " + peso(expected) + ", " + (diff === 0 ? "exact." : (diff > 0 ? "over by " + peso(diff) + "." : "short by " + peso(-diff) + "."));
    renderShifts();
  } catch (e) { $("shiftMsg").textContent = e.message; }
};
$("sbSave").onclick = async () => {
  LS.set("sb_url", $("sbUrl").value.trim());
  LS.set("sb_key", $("sbKey").value.trim());
  await connectSupabase();
  if (sb && session) gate(); else renderPOS();
  const n = await syncNow().catch(() => 0);
  if (n) alert("Sent " + n + " queued sale(s).");
};
$("exportBtn").onclick = () => {
  const sales = LS.get("pos_sales", []);
  const rows = ["date,subtotal,discount,total,profit,status", ...sales.map(s => s.created_at + "," + ((s.subtotal_cents ?? s.total_cents) / 100).toFixed(2) + "," + ((s.discount_cents || 0) / 100).toFixed(2) + "," + (s.total_cents / 100).toFixed(2) + "," + ((s.profit_cents || 0) / 100).toFixed(2) + "," + (s.status || "active"))];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = "sales.csv"; a.click();
};

// ---------- Start ----------
seed();
tickClock();
setInterval(tickClock, 20000);
$("sbUrl").value = LS.get("sb_url", "");
$("sbKey").value = LS.get("sb_key", "");
await connectSupabase().catch(() => null);
gate();
