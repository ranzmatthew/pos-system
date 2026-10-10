export function createStockModule(deps) {
  const { $, LS, getSupabase, getSession, listProducts, peso, escapeHtml, uuid, openProductModal, openDeleteProductModal } = deps;
  let activeTab = "overview";
  let stockStatusFilter = "all";
  let movementType = "restock";

  const getPending = () => LS.get("pos_stock_outbox_v1", []);
  const setPending = (items) => LS.set("pos_stock_outbox_v1", items);
  const getLocalMovements = () => LS.get("pos_stock_movements_v1", []);
  const setLocalMovements = (items) => LS.set("pos_stock_movements_v1", items);

  function activeOwner() { return getSession()?.role === "owner"; }
  function movementLabel(type) {
    return ({ opening_balance: "Opening balance", sale: "Sale", void_reversal: "Voided sale", restock: "Restock", adjustment: "Adjustment" })[type] || "Stock update";
  }
  function currentActor() {
    const s = getSession();
    return s?.sbUser?.id || s?.email || "Owner";
  }
  function addLocalMovement(movement) {
    const records = getLocalMovements();
    if (records.some(row => row.source_key === movement.source_key)) return;
    records.unshift({
      id: movement.id || uuid(),
      product_id: movement.product_id || null,
      product_name: movement.product_name || "Product",
      movement_type: movement.movement_type,
      quantity_delta: movement.quantity_delta,
      quantity_before: movement.quantity_before,
      quantity_after: movement.quantity_after,
      reason: movement.reason || null,
      sale_id: movement.sale_id || null,
      sale_item_id: movement.sale_item_id || null,
      source_key: movement.source_key,
      actor_id: movement.actor_id || currentActor(),
      actor_email: movement.actor_email || getSession()?.email || "Owner",
      occurred_at: movement.occurred_at || new Date().toISOString(),
      pending_sync: !!movement.pending_sync
    });
    setLocalMovements(records);
  }
  function ensureOpeningBalances(products) {
    const rows = getLocalMovements();
    const keys = new Set(rows.map(row => row.source_key));
    for (const product of products) {
      const key = "opening:" + product.id;
      if (keys.has(key)) continue;
      addLocalMovement({
        product_id: product.id,
        product_name: product.name,
        movement_type: "opening_balance",
        quantity_delta: Number(product.stock) || 0,
        quantity_before: 0,
        quantity_after: Number(product.stock) || 0,
        reason: "Opening balance when stock tracking began",
        source_key: key
      });
    }
    LS.set("pos_stock_tracking_started_v1", true);
  }
  function updateCachedStock(productId, stock) {
    const products = LS.get("pos_products", []);
    LS.set("pos_products", products.map(product =>
      String(product.id) === String(productId) ? { ...product, stock } : product
    ));
  }
  function applyPendingToProducts(products) {
    const rows = products.map(product => ({ ...product }));
    const byId = new Map(rows.map(product => [String(product.id), product]));
    for (const sale of LS.get("pos_outbox", [])) {
      for (const line of sale.lines || []) {
        const product = byId.get(String(line.id || line.product_id || ""));
        if (!product || String(product.id).startsWith("c_")) continue;
        if (Number(product.stock) === Number(line.stock)) product.stock -= Number(line.qty) || 0;
      }
    }
    for (const movement of getPending()) {
      const product = byId.get(String(movement.product_id));
      if (product && Number(product.stock) === Number(movement.expected_stock)) {
        product.stock += Number(movement.quantity_delta) || 0;
      }
    }
    return rows;
  }
  async function getMovements() {
    let remote = [];
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("stock_movements").select("*").order("occurred_at", { ascending: false }).limit(500);
      if (error) throw error;
      remote = data || [];
      const actorIds = [...new Set(remote.map(row => row.actor_id).filter(Boolean))];
      if (actorIds.length) {
        const { data: actors } = await sb.from("profiles").select("id,email").in("id", actorIds);
        const names = new Map((actors || []).map(actor => [actor.id, actor.email]));
        remote = remote.map(row => ({ ...row, actor_email: names.get(row.actor_id) || row.actor_id }));
      }
    }
    const merged = new Map();
    for (const row of getLocalMovements()) merged.set(row.source_key || row.id, row);
    for (const row of remote) merged.set(row.source_key || row.id, row);
    for (const pending of getPending()) {
      const local = getLocalMovements().find(row => row.source_key === "manual:" + pending.movement_id);
      if (local && !merged.has(local.source_key)) merged.set(local.source_key, local);
    }
    return [...merged.values()].sort((a, b) => new Date(b.occurred_at || b.created_at || 0) - new Date(a.occurred_at || a.created_at || 0));
  }
  function movementMarkup(row) {
    const delta = Number(row.quantity_delta) || 0;
    const label = movementLabel(row.movement_type);
    const time = row.occurred_at || row.created_at;
    const when = time ? new Date(time).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
    const actor = row.actor_email || row.actor?.email || (row.actor_id ? "Owner" : "Local");
    const detail = [when, actor, row.reason, row.sale_id ? "Sale #" + String(row.sale_id).slice(0, 8) : ""].filter(Boolean).join(" · ");
    const status = row.pending_sync ? '<small class="stock-pending">Pending sync</small>' : "";
    const signed = (delta > 0 ? "+" : "") + delta;
    return '<article class="stock-movement-row"><div class="stock-movement-copy"><b>' + escapeHtml(row.product_name || "Product") + " · " + escapeHtml(label) + '</b><small>' + escapeHtml(detail) + "</small>" + status + '</div><span class="stock-movement-delta ' + (delta < 0 ? "negative" : "positive") + '">' + escapeHtml(signed) + '</span></article>';
  }
  async function render() {
    if (!activeOwner()) {
      $("invList").innerHTML = '<p class="mut">Owner access required.</p>';
      return;
    }
    const products = await listProducts();
    const sb = getSupabase();
    if (!sb) ensureOpeningBalances(products);
    const visibleProducts = sb ? applyPendingToProducts(products) : products;
    document.querySelectorAll("[data-stock-tab]").forEach(button => {
      const active = button.dataset.stockTab === activeTab;
      button.classList.toggle("on", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("stockOverviewPanel").classList.toggle("hidden", activeTab !== "overview");
    $("stockProductsPanel").classList.toggle("hidden", activeTab !== "products");
    $("stockHistoryPanel").classList.toggle("hidden", activeTab !== "history");
    $("stockProductCount").textContent = visibleProducts.length;
    $("stockLowCount").textContent = visibleProducts.filter(p => p.stock > 0 && p.stock <= (p.reorder_level ?? 5)).length;
    $("stockOutCount").textContent = visibleProducts.filter(p => p.stock <= 0).length;
    $("stockValue").textContent = peso(visibleProducts.reduce((sum, p) => sum + (Number(p.stock) || 0) * (Number(p.cost_cents) || 0), 0));
    const pendingCount = getPending().length + LS.get("pos_outbox", []).length;
    $("stockSyncStatus").textContent = sb
      ? (pendingCount ? "Online · " + pendingCount + " changes waiting to sync" : "Online · stock is up to date")
      : "Offline demo · changes stay on this device";
    $("stockSyncStatus").classList.toggle("stock-pending", pendingCount > 0);
    let movements = [];
    let movementsError = null;
    try { movements = await getMovements(); } catch (error) { movementsError = error; movements = getLocalMovements(); }
    const value = $("stockPeriod").value;
    const now = new Date();
    const start = value === "today" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(Date.now() - Number(value || 7) * 86400000);
    const period = movements.filter(row => new Date(row.occurred_at || row.created_at || 0) >= start);
    $("stockSoldUnits").textContent = period.filter(row => row.movement_type === "sale").reduce((sum, row) => sum + Math.abs(Number(row.quantity_delta) || 0), 0);
    $("stockReceivedUnits").textContent = period.filter(row => row.movement_type === "restock").reduce((sum, row) => sum + (Number(row.quantity_delta) || 0), 0);
    const empty = '<p class="stock-empty">No stock activity in this period yet.</p>';
    const recentRows = movements.slice(0, 5);
    $("stockRecentMovements").innerHTML = recentRows.map(movementMarkup).join("") || empty;
    $("stockMovementHistory").innerHTML = movements.map(movementMarkup).join("") || empty;
    if (movementsError && sb) {
      $("stockSyncStatus").textContent = "Offline · showing saved stock data";
      $("stockSyncStatus").classList.add("stock-pending");
    }
    if (activeTab === "products") renderProducts(visibleProducts);
  }
  function getStockStatus(product) {
    const stock = Number(product.stock) || 0;
    const threshold = Math.max(0, Number(product.reorder_level ?? 5));
    if (stock <= 0) return "out";
    if (stock <= threshold) return "low";
    if (stock <= threshold * 2) return "medium";
    return "high";
  }
  function renderProducts(products) {
    const labels = { high: "High stock", medium: "Medium stock", low: "Low stock", out: "Out of stock" };
    const filteredProducts = products.filter(product => stockStatusFilter === "all" || getStockStatus(product) === stockStatusFilter);
    $("invList").innerHTML = filteredProducts.map(p =>
      '<article class="inventory-card">'
      + '<div class="inventory-details"><div class="inventory-product-heading"><b>' + escapeHtml(p.name) + '</b>'
      + '<span class="stock-status-badge stock-status-' + getStockStatus(p) + '">' + labels[getStockStatus(p)] + '</span></div>'
      + '<div class="mut">' + peso(p.price_cents - p.cost_cents) + ' profit / pc · <strong class="inventory-stock-quantity">' + Number(p.stock) + ' pcs</strong></div></div>'
      + '<div class="inv-menu-wrap"><button class="inv-more" type="button" data-menu="' + escapeHtml(p.id) + '" aria-label="More actions for ' + escapeHtml(p.name) + '" aria-haspopup="menu" aria-expanded="false">&#8942;</button>'
      + '<div class="inv-menu hidden" role="menu"><button type="button" role="menuitem" data-edit="' + escapeHtml(p.id) + '">Edit</button><button type="button" role="menuitem" data-del="' + escapeHtml(p.id) + '">Delete</button></div></div>'
      + '</article>'
    ).join("") || '<p class="mut">' + (products.length ? 'No products match this stock status.' : 'No products yet.') + '</p>';
    document.querySelectorAll("[data-menu]").forEach(button => button.onclick = event => {
      event.stopPropagation();
      const menu = button.parentElement.querySelector(".inv-menu");
      const opening = menu.classList.contains("hidden");
      document.querySelectorAll(".inv-menu").forEach(item => item.classList.add("hidden"));
      document.querySelectorAll("[data-menu]").forEach(item => item.setAttribute("aria-expanded", "false"));
      menu.classList.toggle("hidden", !opening);
      button.setAttribute("aria-expanded", String(opening));
    });
    document.querySelectorAll("[data-edit]").forEach(button => button.onclick = () => {
      const product = products.find(item => String(item.id) === button.dataset.edit);
      if (product) openProductModal(product);
    });
    document.querySelectorAll("[data-del]").forEach(button => button.onclick = () => {
      const product = products.find(item => String(item.id) === button.dataset.del);
      if (product) openDeleteProductModal(product);
    });
  }
  function setTab(tab) {
    if (!["overview", "products", "history"].includes(tab)) return;
    const changed = activeTab !== tab;
    activeTab = tab;
    render().then(() => {
      if (!changed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const panel = $(({ overview: "stockOverviewPanel", products: "stockProductsPanel", history: "stockHistoryPanel" })[activeTab]);
      panel.classList.remove("stock-panel-enter");
      void panel.offsetWidth;
      panel.classList.add("stock-panel-enter");
    }).catch(error => {
      $("stockSyncStatus").textContent = "Could not load stock: " + (error?.message || "Unknown error");
      $("stockSyncStatus").classList.add("stock-pending");
    });
  }
  function openMovement(type) {
    movementType = type;
    $("stockMovementTitle").textContent = type === "restock" ? "Restock product" : "Adjust stock";
    $("stockMovementQty").value = "";
    $("stockMovementQty").min = type === "restock" ? "1" : "";
    $("stockMovementQty").placeholder = type === "restock" ? "Enter quantity" : "Signed quantity, e.g. -2 or 5";


    $("stockMovementError").classList.add("hidden");
    listProducts().then(products => {
      const currentProducts = getSupabase() ? applyPendingToProducts(products) : products;
      $("stockMovementProduct").innerHTML = currentProducts.map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + " · " + Number(p.stock) + " in stock</option>").join("");
      $("stockMovementModal").classList.remove("hidden");
      $("stockMovementProduct").focus();
    }).catch(error => {
      $("stockMovementError").textContent = error.message;
      $("stockMovementError").classList.remove("hidden");
      $("stockMovementModal").classList.remove("hidden");
    });
  }
  function setLocalQuantity(product, next, movement, pending) {
    const products = LS.get("pos_products", []);
    LS.set("pos_products", products.map(row => String(row.id) === String(product.id) ? { ...row, stock: next } : row));
    addLocalMovement({ ...movement, pending_sync: pending });
    if (pending) {
      const queue = getPending();
      if (!queue.some(row => row.movement_id === movement.movement_id)) queue.push(movement);
      setPending(queue);
    }
  }
  function isNetworkFailure(error) {
    const message = String(error?.message || error || "");
    return /failed to fetch|network|offline|load failed|fetch error|connection/i.test(message);
  }
  async function saveMovement() {
    const productId = $("stockMovementProduct").value;
    const loadedProducts = await listProducts();
    const products = getSupabase() ? applyPendingToProducts(loadedProducts) : loadedProducts;
    const product = products.find(row => String(row.id) === String(productId));
    const raw = $("stockMovementQty").value.trim();
    const amount = Number(raw);
    const reason = movementType === "adjustment" ? "Manual stock adjustment" : "";
    const delta = movementType === "restock" ? amount : amount;
    if (!product) return showMovementError("Select a product.");
    if (!Number.isInteger(amount) || amount === 0 || (movementType === "restock" && amount < 1)) return showMovementError("Enter a valid whole-number quantity.");

    if (Number(product.stock) + delta < 0) return showMovementError("This adjustment cannot make stock negative.");
    if (getSupabase() && String(product.id).startsWith("c_")) return showMovementError("This product only exists on this device. Reconnect or recreate it online before syncing stock.");
    const movementId = uuid();
    const movement = {
      movement_id: movementId, product_id: product.id, product_name: product.name,
      movement_type: movementType, quantity_delta: delta, expected_stock: Number(product.stock),
      reason, source_key: "manual:" + movementId
    };
    const button = $("saveStockMovementBtn");
    button.disabled = true;
    try {
      const sb = getSupabase();
      if (sb) {
        const { data, error } = await sb.rpc("apply_stock_movement", {
          p_product_id: product.id, p_movement_id: movementId, p_movement_type: movementType,
          p_quantity_delta: delta, p_reason: reason || null, p_expected_stock: Number(product.stock)
        });
        if (error) {
          if (!isNetworkFailure(error)) throw error;
          setLocalQuantity(product, Number(product.stock) + delta, {
            id: movementId, product_id: product.id, product_name: product.name,
            movement_type: movementType, quantity_delta: delta,
            quantity_before: Number(product.stock), quantity_after: Number(product.stock) + delta,
            reason, source_key: movement.source_key
          }, true);
        } else {
          const result = Array.isArray(data) ? data[0] : data;
          updateCachedStock(product.id, result?.stock ?? Number(product.stock) + delta);
        }
      } else {
        setLocalQuantity(product, Number(product.stock) + delta, {
          id: movementId, product_id: product.id, product_name: product.name,
          movement_type: movementType, quantity_delta: delta,
          quantity_before: Number(product.stock), quantity_after: Number(product.stock) + delta,
          reason, source_key: movement.source_key
        }, false);
      }
      $("stockMovementModal").classList.add("hidden");
      await render();
    } catch (error) {
      showMovementError(error?.message || "Stock could not be updated.");
    } finally {
      button.disabled = false;
    }
  }
  function showMovementError(message) {
    $("stockMovementError").textContent = message;
    $("stockMovementError").classList.remove("hidden");
  }
  function saveLocalProduct(product) {
    product.category = String(product.category ?? "").trim() || "N/A";
    const rows = LS.get("pos_products", []);
    const index = rows.findIndex(row => String(row.id) === String(product.id));
    if (index >= 0) {
      const before = Number(rows[index].stock) || 0;
      const delta = Number(product.stock) - before;
      if (delta && !String(product.stock_reason || "").trim()) throw new Error("Enter a reason for the stock adjustment.");
      rows[index] = product;
      LS.set("pos_products", rows);
      if (delta) addLocalMovement({
        product_id: product.id, product_name: product.name, movement_type: "adjustment",
        quantity_delta: delta, quantity_before: before, quantity_after: Number(product.stock),
        reason: product.stock_reason, source_key: "product-edit:" + uuid()
      });
      return;
    }
    product.id = product.id || "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    rows.push(product);
    LS.set("pos_products", rows);
    addLocalMovement({
      product_id: product.id, product_name: product.name, movement_type: "opening_balance",
      quantity_delta: Number(product.stock) || 0, quantity_before: 0, quantity_after: Number(product.stock) || 0,
      reason: "Starting stock for new product", source_key: "product-opening:" + product.id
    });
  }
  function recordLocalSale(sale, lines) {
    lines.forEach((line, index) => {
      if (String(line.id).startsWith("c_")) return;
      addLocalMovement({
        product_id: line.id, product_name: line.name, movement_type: "sale",
        quantity_delta: -Number(line.qty), quantity_before: Number(line.stock),
        quantity_after: Number(line.stock) - Number(line.qty), sale_id: sale.id,
        reason: null, source_key: "sale:" + sale.client_id + ":line:" + (index + 1),
        pending_sync: !!getSupabase()
      });
    });
  }
  function recordLocalVoid(sale) {
    const products = LS.get("pos_products", []);
    (sale.lines || []).forEach((line, index) => {
      const product = products.find(row => String(row.id) === String(line.id) || row.name === line.name);
      if (!product) return;
      const after = Number(product.stock) || 0;
      const before = after - (Number(line.qty) || 0);
      addLocalMovement({
        product_id: product.id, product_name: product.name, movement_type: "void_reversal",
        quantity_delta: Number(line.qty) || 0, quantity_before: before,
        quantity_after: after, reason: sale.void_reason || null,
        sale_id: sale.id, source_key: "void:" + sale.client_id + ":line:" + (index + 1)
      });
    });
  }
  function markMovementsSynced(sourcePrefix) {
    setLocalMovements(getLocalMovements().map(row =>
      row.source_key?.startsWith(sourcePrefix) ? { ...row, pending_sync: false } : row
    ));
  }
  async function syncPending() {
    const sb = getSupabase();
    if (!sb) return 0;
    const queue = getPending();
    const remaining = [];
    let sent = 0;
    for (const movement of queue) {
      try {
        const { data, error } = await sb.rpc("apply_stock_movement", {
          p_product_id: movement.product_id,
          p_movement_id: movement.movement_id,
          p_movement_type: movement.movement_type,
          p_quantity_delta: movement.quantity_delta,
          p_reason: movement.reason || null,
          p_expected_stock: movement.expected_stock
        });
        if (error) throw error;
        const result = Array.isArray(data) ? data[0] : data;
        updateCachedStock(movement.product_id, result?.stock ?? movement.expected_stock + movement.quantity_delta);
        markMovementsSynced("manual:" + movement.movement_id);
        sent += 1;
      } catch { remaining.push(movement); }
    }
    setPending(remaining);
    return sent;
  }
  function pendingCount() { return getPending().length + LS.get("pos_outbox", []).length; }
  function markSaleSynced(clientId) { markMovementsSynced("sale:" + clientId + ":line:"); }

  document.querySelectorAll("[data-stock-tab]").forEach(button => button.onclick = () => setTab(button.dataset.stockTab));
  $("stockStatusFilter").onchange = () => {
    stockStatusFilter = $("stockStatusFilter").value;
    setTab(activeTab);
  };
  $("stockPeriod").onchange = () => render().catch(() => {});
  $("adjustStockBtn").onclick = () => openMovement("adjustment");
  $("saveStockMovementBtn").onclick = saveMovement;
  $("cancelStockMovementBtn").onclick = () => $("stockMovementModal").classList.add("hidden");
  $("stockMovementModal").onclick = event => { if (event.target === $("stockMovementModal")) $("stockMovementModal").classList.add("hidden"); };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("stockMovementModal").classList.contains("hidden")) $("stockMovementModal").classList.add("hidden");
  });

  return {
    render, setTab, getTab: () => activeTab, saveLocalProduct, recordLocalSale, recordLocalVoid, markSaleSynced, syncPending,
    pendingCount, ensureOpeningBalances, updateCachedStock, getLocalMovements
  };
}
