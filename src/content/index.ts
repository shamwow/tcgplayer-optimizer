import type { ExtensionMessage, CartItem, CartSummary, OptimizationResult, OptimizeMode } from "@/types";

/**
 * Content script injected on tcgplayer.com/cart pages.
 * Renders the optimizer overlay panel using Shadow DOM for style isolation.
 */

const OVERLAY_ID = "tcg-optimizer-overlay";

function createOverlay(): { root: ShadowRoot; container: HTMLDivElement } {
  // Remove existing overlay if any
  document.getElementById(OVERLAY_ID)?.remove();

  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // Inject styles into shadow DOM
  const style = document.createElement("style");
  style.textContent = getOverlayStyles();
  shadow.appendChild(style);

  const container = document.createElement("div");
  container.id = "tcg-optimizer-root";
  shadow.appendChild(container);

  return { root: shadow, container };
}

function getOverlayStyles(): string {
  return `
    #tcg-optimizer-root {
      position: fixed;
      top: 0;
      right: 0;
      width: 420px;
      height: 100vh;
      background: #f3f4f6;
      border-left: 1px solid #d1d5db;
      box-shadow: -4px 0 20px rgba(0,0,0,0.1);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      overflow-y: auto;
      transition: transform 0.25s ease;
    }
    #tcg-optimizer-root.hidden {
      transform: translateX(100%);
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid #e5e7eb;
      background: #1a3a5c;
      color: white;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .panel-header h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .close-btn {
      background: none;
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      opacity: 0.8;
    }
    .close-btn:hover { opacity: 1; }
    .panel-body {
      padding: 12px;
    }

    /* Card system */
    .card {
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }
    .card-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      padding: 10px 14px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    .card-body {
      padding: 14px;
    }

    /* Stats grid */
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .stat-item {}
    .stat-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9ca3af;
      margin-bottom: 2px;
    }
    .stat-value {
      font-size: 15px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .stat-value.highlight {
      color: #2563eb;
    }

    /* Expandable */
    .expandable-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      cursor: pointer;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 12px;
      font-weight: 500;
      user-select: none;
      background: none;
      border-left: none;
      border-right: none;
      border-bottom: none;
      width: 100%;
      text-align: left;
    }
    .expandable-trigger:hover {
      background: #f9fafb;
    }
    .expandable-chevron {
      transition: transform 0.2s ease;
      font-size: 10px;
    }
    .expandable-chevron.open {
      transform: rotate(90deg);
    }
    .expandable-content {
      display: none;
    }
    .expandable-content.open {
      display: block;
    }

    /* Filter controls */
    .filter-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .filter-row:last-child {
      border-bottom: none;
    }
    .filter-label {
      font-size: 13px;
      font-weight: 500;
      color: #374151;
    }
    .filter-select {
      padding: 4px 8px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 12px;
      background: white;
      color: #1a1a1a;
    }
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      -webkit-appearance: none;
      appearance: none;
      background: #d1d5db;
      border-radius: 10px;
      outline: none;
      cursor: pointer;
      transition: background 0.2s;
      border: none;
    }
    .toggle-switch:checked {
      background: #2563eb;
    }
    .toggle-switch::before {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle-switch:checked::before {
      transform: translateX(16px);
    }

    /* Mode toggle */
    .mode-toggle {
      display: flex;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      overflow: hidden;
    }
    .mode-btn {
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 500;
      border: none;
      background: white;
      color: #6b7280;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .mode-btn:first-child {
      border-right: 1px solid #d1d5db;
    }
    .mode-btn.active {
      background: #2563eb;
      color: white;
    }
    .mode-btn:hover:not(.active) {
      background: #f3f4f6;
    }

    /* Existing styles preserved */
    .error-box {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 12px;
      color: #dc2626;
      font-size: 12px;
    }
    .status-text {
      color: #666;
      font-size: 12px;
      text-align: center;
      padding: 20px 0;
    }
    .cart-item {
      padding: 8px 12px;
      border-bottom: 1px solid #f3f4f6;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cart-item:last-child { border-bottom: none; }
    .cart-item-name {
      font-weight: 500;
      font-size: 13px;
    }
    .cart-item-meta {
      color: #6b7280;
      font-size: 11px;
      margin-top: 2px;
    }
    .cart-item-price {
      font-weight: 600;
      white-space: nowrap;
      font-size: 13px;
    }
    .optimize-btn {
      width: 100%;
      padding: 12px 16px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .optimize-btn:hover { background: #1d4ed8; }
    .optimize-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    .progress {
      margin-bottom: 12px;
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .progress-bar {
      height: 6px;
      background: #e5e7eb;
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .savings-box {
      border-radius: 6px;
      padding: 14px;
      margin-bottom: 12px;
      text-align: center;
    }
    .savings-box.positive {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
    }
    .savings-box.neutral {
      background: #fefce8;
      border: 1px solid #fef08a;
    }
    .savings-amount {
      font-size: 24px;
      font-weight: 700;
      color: #16a34a;
    }
    .savings-detail {
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
    }
    .savings-time {
      font-size: 10px;
      color: #9ca3af;
      margin-top: 4px;
    }
    .results-section {
      margin-bottom: 12px;
    }
    .results-header {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .results-table-wrapper {
      overflow-x: auto;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      margin-top: 10px;
    }
    .results-table {
      width: 100%;
      min-width: 480px;
      border-collapse: collapse;
      font-size: 11px;
    }
    .results-table th {
      background: #f9fafb;
      text-align: left;
      padding: 6px 8px;
      font-weight: 600;
      white-space: nowrap;
    }
    .results-table th.right { text-align: right; }
    .results-table td {
      padding: 5px 8px;
      border-top: 1px solid #f3f4f6;
      white-space: nowrap;
    }
    .results-table td.right { text-align: right; }
    .results-table td.sub-detail {
      padding: 0 8px 4px;
      border-top: none;
      color: #9ca3af;
      font-size: 10px;
      word-break: break-word;
      white-space: normal;
    }
    .results-table td.sub-empty {
      padding: 0;
      border-top: none;
    }
    .price-cheaper { color: #16a34a; font-weight: 600; }
    .price-same { font-weight: 600; }
    .price-more { color: #dc2626; font-weight: 600; }
    .kept-row { color: #9ca3af; }
    .kept-label { font-size: 10px; color: #9ca3af; font-style: italic; }
    .seller-card {
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
    }
    .seller-card:last-child { border-bottom: none; }
    .seller-top {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .seller-detail {
      color: #6b7280;
      font-size: 11px;
    }
    .copy-btn {
      width: 100%;
      padding: 12px 16px;
      background: #1a3a5c;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .copy-btn:hover { background: #0f2940; }
    .copy-btn.copied { background: #16a34a; }
  `;
}

// --- Overlay State & Rendering ---

interface OverlayState {
  visible: boolean;
  error: string | null;
  // Card 1
  cartLoaded: boolean;
  items: CartItem[];
  summary: CartSummary | null;
  cartExpanded: boolean;
  // Card 2
  optimizerStage: "loading" | "idle" | "optimizing" | "done";
  optimizeMode: OptimizeMode;
  filterVerified: boolean;
  progress: { stage: string; progress: number };
  result: OptimizationResult | null;
  resultsExpanded: boolean;
}

let state: OverlayState = {
  visible: true,
  error: null,
  cartLoaded: false,
  items: [],
  summary: null,
  cartExpanded: false,
  optimizerStage: "loading",
  optimizeMode: "cheapest",
  filterVerified: true,
  progress: { stage: "", progress: 0 },
  result: null,
  resultsExpanded: false,
};

let overlayContainer: HTMLDivElement | null = null;

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function render() {
  if (!overlayContainer) return;
  overlayContainer.className = state.visible ? "" : "hidden";
  overlayContainer.id = "tcg-optimizer-root";

  let html = `
    <div class="panel-header">
      <h1>Cart Optimizer</h1>
      <button class="close-btn" id="tcg-opt-close">&times;</button>
    </div>
    <div class="panel-body">
  `;

  if (state.error) {
    html += `<div class="error-box">${escHtml(state.error)}</div>`;
  }

  if (!state.cartLoaded) {
    html += `<div class="status-text">Reading cart...</div>`;
  } else if (state.items.length === 0) {
    html += `<div class="status-text">Your cart is empty. Add items to your cart and reload.</div>`;
  } else {
    // --- Card 1: Current Cart ---
    html += renderCartCard();

    // --- Card 2: Optimizer ---
    html += renderOptimizerCard();
  }

  html += `</div>`;
  overlayContainer.innerHTML = html;
  bindEvents();
}

function renderCartCard(): string {
  const s = state.summary;
  const items = state.items;

  // Derive fallback values from items
  const sellerCount = s
    ? s.sellerCount
    : new Set(items.map((i) => i.currentSeller)).size;
  const itemCount = s ? s.itemCount : items.length;
  const cartCostCents = s
    ? s.cartCostCents
    : items.reduce((sum, i) => sum + i.currentPriceCents, 0);
  const shippingCents = s ? s.shippingCostCents : null;
  const totalCents = shippingCents !== null
    ? cartCostCents + shippingCents
    : cartCostCents;

  let html = `<div class="card">`;
  html += `<div class="card-title">Current Cart</div>`;
  html += `<div class="card-body">`;
  html += `<div class="stats-grid">`;
  html += `
    <div class="stat-item">
      <div class="stat-label">Packages</div>
      <div class="stat-value">${sellerCount}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Items</div>
      <div class="stat-value">${itemCount}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Cart Cost</div>
      <div class="stat-value">${fmt(cartCostCents)}</div>
    </div>
    <div class="stat-item">
      <div class="stat-label">Shipping</div>
      <div class="stat-value">${shippingCents !== null ? fmt(shippingCents) : "\u2014"}</div>
    </div>
  `;
  html += `</div>`; // stats-grid

  // Total row
  html += `
    <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;font-weight:600;color:#374151">Total</span>
      <span class="stat-value highlight">${fmt(totalCents)}</span>
    </div>
  `;
  html += `</div>`; // card-body

  // Expandable item list
  html += `
    <button class="expandable-trigger" id="tcg-opt-expand-cart">
      <span>View all ${items.length} items</span>
      <span class="expandable-chevron ${state.cartExpanded ? "open" : ""}">&#9654;</span>
    </button>
    <div class="expandable-content ${state.cartExpanded ? "open" : ""}">
      <div style="padding:0 14px 14px">
        <div class="results-table-wrapper">
          <table class="results-table">
            <thead><tr><th>Card</th><th>Condition</th><th>Seller</th><th class="right">Price</th></tr></thead>
            <tbody>
  `;
  const sortedItems = [...items].sort((a, b) => a.name.localeCompare(b.name));
  for (const item of sortedItems) {
    html += `<tr>
      <td title="${escHtml(item.name)}">${escHtml(item.name)}</td>
      <td>${escHtml(item.condition)}${item.printing !== "Normal" && !item.condition.includes(item.printing) ? " " + escHtml(item.printing) : ""}</td>
      <td>${escHtml(item.currentSeller) || "\u2014"}</td>
      <td class="right" style="font-weight:600">${fmt(item.currentPriceCents)}</td>
    </tr>
    <tr><td class="sub-detail">${escHtml(item.setName)}</td><td class="sub-empty"></td><td class="sub-empty"></td><td class="sub-empty"></td></tr>`;
  }
  html += `</tbody></table></div></div>
    </div>`; // expandable-content
  html += `</div>`; // card

  return html;
}

function renderOptimizerCard(): string {
  let html = `<div class="card">`;
  html += `<div class="card-title">Optimizer</div>`;
  html += `<div class="card-body">`;

  if (state.optimizerStage === "idle") {
    // Mode selector
    html += `
      <div class="filter-row">
        <span class="filter-label">Mode</span>
        <div class="mode-toggle">
          <button class="mode-btn ${state.optimizeMode === "cheapest" ? "active" : ""}" id="tcg-opt-mode-cheapest">Cheapest</button>
          <button class="mode-btn ${state.optimizeMode === "fewest-packages" ? "active" : ""}" id="tcg-opt-mode-fewest">Fewest Packages</button>
        </div>
      </div>
    `;
    // Filter controls
    html += `
      <div class="filter-row">
        <span class="filter-label">Verified Sellers Only</span>
        <input type="checkbox" class="toggle-switch" id="tcg-opt-verified" ${state.filterVerified ? "checked" : ""}>
      </div>
    `;
    html += `<div style="margin-top:12px">`;
    html += `<button class="optimize-btn" id="tcg-opt-run">Optimize ${state.items.length} Items</button>`;
    html += `</div>`;
  }

  if (state.optimizerStage === "optimizing") {
    const pct = Math.round(state.progress.progress * 100);
    html += `
      <div class="progress">
        <div class="progress-info">
          <span>${escHtml(state.progress.stage)}</span>
          <span>${pct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  if (state.optimizerStage === "done" && state.result) {
    const r = state.result;
    const savPct = r.originalTotalCents > 0
      ? Math.round((r.savingsCents / r.originalTotalCents) * 100) : 0;
    const isPositive = r.savingsCents > 0;

    // Optimized stats
    const optCartCost = r.assignments.reduce((sum, a) => sum + a.listing.priceCents, 0);
    const optShipping = r.sellers.reduce((sum, s) => sum + s.shippingCents, 0);

    html += `<div class="stats-grid">`;
    html += `
      <div class="stat-item">
        <div class="stat-label">Packages</div>
        <div class="stat-value">${r.sellers.length}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Items</div>
        <div class="stat-value">${r.assignments.length}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Cart Cost</div>
        <div class="stat-value">${fmt(optCartCost)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Shipping</div>
        <div class="stat-value">${fmt(optShipping)}</div>
      </div>
    `;
    html += `</div>`;

    // Total row (mirrors Current Cart card)
    html += `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:600;color:#374151">Total</span>
        <span class="stat-value highlight">${fmt(r.totalCostCents)}</span>
      </div>
    `;
    if (isPositive) {
      html += `
        <div style="text-align:right;font-size:11px;color:#16a34a;margin-top:2px">
          ${savPct}% savings &mdash; ${fmt(r.originalTotalCents)} &rarr; ${fmt(r.totalCostCents)} &middot; ${r.solveTimeMs}ms
        </div>
      `;
    }

    // Expandable results
    html += `</div>`; // close card-body before trigger
    html += `
      <button class="expandable-trigger" id="tcg-opt-expand-results">
        <span>View optimized allocation</span>
        <span class="expandable-chevron ${state.resultsExpanded ? "open" : ""}">&#9654;</span>
      </button>
      <div class="expandable-content ${state.resultsExpanded ? "open" : ""}">
        <div style="padding:0 14px 14px">
    `;

    // Results table
    html += `
      <div class="results-section">
        <div class="results-table-wrapper">
        <table class="results-table">
          <thead><tr><th>Card</th><th>Condition</th><th>Old Seller</th><th>New Seller</th><th class="right">Old</th><th class="right">New</th></tr></thead>
          <tbody>
    `;
    const itemByIndex = new Map(state.items.map((i) => [i.cartIndex, i]));
    const sortedAssignments = [...r.assignments].sort((a, b) => a.name.localeCompare(b.name));
    for (const a of sortedAssignments) {
      const isKept = a.listing.listingId === "current";
      const cls = isKept ? "price-same" : a.savingsCents > 0 ? "price-cheaper" : a.savingsCents < 0 ? "price-more" : "price-same";
      const cartItem = itemByIndex.get(a.cartIndex);
      const oldSeller = escHtml(cartItem?.currentSeller ?? "");
      const newSeller = isKept ? oldSeller : escHtml(a.listing.sellerName);
      const nameCell = isKept
        ? `<span style="color:#b45309" title="Skipped — no listings found">&#9888;</span> ${escHtml(a.name)}`
        : escHtml(a.name);
      html += `<tr>
        <td>${nameCell}</td>
        <td>${escHtml(cartItem?.condition ?? "")}${cartItem?.printing && cartItem.printing !== "Normal" && !cartItem.condition.includes(cartItem.printing) ? " " + escHtml(cartItem.printing) : ""}</td>
        <td style="color:#9ca3af">${oldSeller || "\u2014"}</td>
        <td>${newSeller || "\u2014"}</td>
        <td class="right" style="color:#6b7280">${fmt(a.originalPriceCents)}</td>
        <td class="right ${cls}">${fmt(a.listing.priceCents)}</td>
      </tr>
      <tr><td class="sub-detail">${escHtml(cartItem?.setName ?? "")}</td><td class="sub-empty"></td><td class="sub-empty"></td><td class="sub-empty"></td><td class="sub-empty"></td><td class="sub-empty"></td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // Skipped cards warning
    if (r.skippedCards && r.skippedCards.length > 0) {
      html += `
        <div class="results-section">
          <div class="results-header" style="color:#b45309">&#9888; Skipped Cards (${r.skippedCards.length})</div>
          <div style="border:1px solid #fef08a;border-radius:6px;overflow:hidden;background:#fffbeb">
      `;
      for (const sc of r.skippedCards) {
        html += `
          <div class="cart-item" style="border-color:#fef08a">
            <div>
              <div class="cart-item-name"><span style="color:#b45309">&#9888;</span> ${escHtml(sc.name)}</div>
              <div class="cart-item-meta">${escHtml(sc.condition)}${sc.printing !== "Normal" && !sc.condition.includes(sc.printing) ? " &middot; " + escHtml(sc.printing) : ""}</div>
              <div class="cart-item-meta" style="color:#b45309">${escHtml(sc.reason)}</div>
            </div>
          </div>
        `;
      }
      html += `</div></div>`;
    }

    html += `</div></div>`; // padding wrapper + expandable-content

    // Copy + Optimize Again buttons (back inside card, outside expandable)
    html += `<div style="padding:0 14px 14px">`;
    html += `<button class="copy-btn" id="tcg-opt-copy" style="margin-bottom:8px">Copy Optimized List</button>`;
    html += `<button class="optimize-btn" id="tcg-opt-again" style="background:#6b7280">Optimize Again</button>`;
    html += `</div>`;

    html += `</div>`; // card
    return html;
  }

  html += `</div>`; // card-body
  html += `</div>`; // card
  return html;
}

function bindEvents() {
  if (!overlayContainer) return;

  overlayContainer.querySelector("#tcg-opt-close")?.addEventListener("click", () => {
    state.visible = false;
    render();
  });

  overlayContainer.querySelector("#tcg-opt-run")?.addEventListener("click", () => {
    runOptimize();
  });

  overlayContainer.querySelector("#tcg-opt-again")?.addEventListener("click", () => {
    state.optimizerStage = "idle";
    state.result = null;
    state.resultsExpanded = false;
    render();
  });

  overlayContainer.querySelector("#tcg-opt-expand-cart")?.addEventListener("click", () => {
    state.cartExpanded = !state.cartExpanded;
    render();
  });

  overlayContainer.querySelector("#tcg-opt-expand-results")?.addEventListener("click", () => {
    state.resultsExpanded = !state.resultsExpanded;
    render();
  });


  overlayContainer.querySelector("#tcg-opt-mode-cheapest")?.addEventListener("click", () => {
    state.optimizeMode = "cheapest";
    render();
  });

  overlayContainer.querySelector("#tcg-opt-mode-fewest")?.addEventListener("click", () => {
    state.optimizeMode = "fewest-packages";
    render();
  });

  overlayContainer.querySelector("#tcg-opt-verified")?.addEventListener("change", (e) => {
    state.filterVerified = (e.target as HTMLInputElement).checked;
  });

  overlayContainer.querySelector("#tcg-opt-copy")?.addEventListener("click", (e) => {
    if (!state.result) return;
    const lines: string[] = [];
    for (const seller of state.result.sellers) {
      lines.push(`// Seller: ${seller.sellerName}`);
      for (const item of seller.items) {
        lines.push(`1 ${item.name}`);
      }
      lines.push("");
    }
    navigator.clipboard.writeText(lines.join("\n").trim());
    const btn = e.target as HTMLButtonElement;
    btn.textContent = "Copied to Clipboard!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copy Optimized List";
      btn.classList.remove("copied");
    }, 2000);
  });
}

function escHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function readCart() {
  console.log("[TCG Optimizer] Reading cart...");
  state.cartLoaded = false;
  state.optimizerStage = "loading";
  state.error = null;
  render();

  try {
    const response: ExtensionMessage = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "READ_CART" } satisfies ExtensionMessage, resolve);
    });

    console.log("[TCG Optimizer] Cart response:", response?.type, response);

    if (response?.type === "CART_DATA") {
      state.items = response.items;
      state.summary = response.summary;
      state.cartLoaded = true;
      state.optimizerStage = "idle";
      console.log(`[TCG Optimizer] Loaded ${response.items.length} cart items`);
    } else if (response?.type === "OPTIMIZATION_ERROR") {
      state.error = response.error;
      state.cartLoaded = true;
      state.optimizerStage = "idle";
      console.error("[TCG Optimizer] Cart read error:", response.error);
    } else {
      state.error = "Could not read cart.";
      state.cartLoaded = true;
      state.optimizerStage = "idle";
      console.error("[TCG Optimizer] Unexpected response:", response);
    }
  } catch (err) {
    state.error = "Could not connect to extension. Try reloading the page.";
    state.cartLoaded = true;
    state.optimizerStage = "idle";
    console.error("[TCG Optimizer] Failed to send READ_CART message:", err);
  }

  render();
}

async function runOptimize() {
  if (state.items.length === 0) return;
  console.log(`[TCG Optimizer] Starting optimization for ${state.items.length} items`);
  state.optimizerStage = "optimizing";
  state.error = null;
  state.progress = { stage: "Starting...", progress: 0 };
  render();

  try {
    const response: ExtensionMessage = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "OPTIMIZE", items: state.items, verifiedOnly: state.filterVerified, mode: state.optimizeMode } satisfies ExtensionMessage,
        resolve
      );
    });

    if (response.type === "OPTIMIZATION_RESULT") {
      state.result = response.result;
      state.optimizerStage = "done";
      console.log("[TCG Optimizer] Optimization complete:", response.result);
    } else if (response.type === "OPTIMIZATION_ERROR") {
      state.error = response.error;
      state.optimizerStage = "idle";
      console.error("[TCG Optimizer] Optimization error:", response.error);
    }
  } catch (err) {
    state.error = "Optimization failed unexpectedly.";
    state.optimizerStage = "idle";
    console.error("[TCG Optimizer] Optimization exception:", err);
  }

  render();
}

// Listen for progress updates
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "OPTIMIZATION_PROGRESS") {
    state.progress = { stage: message.stage, progress: message.progress };
    if (message.detail) {
      console.log(`[TCG Optimizer] ${message.stage} — ${message.detail}`);
    } else {
      console.log(`[TCG Optimizer] ${message.stage} (${Math.round(message.progress * 100)}%)`);
    }
    render();
  }
});

// Listen for toggle from extension icon click
chrome.runtime.onMessage.addListener(
  (message: { type: string }, _sender, sendResponse) => {
    if (message.type === "TOGGLE_OVERLAY") {
      console.log("[TCG Optimizer] Toggle overlay, current visible:", state.visible);
      if (!overlayContainer) {
        console.log("[TCG Optimizer] Creating overlay for first time");
        const { container } = createOverlay();
        overlayContainer = container;
        state.visible = true;
        readCart();
      } else {
        state.visible = !state.visible;
        render();
      }
      console.log("[TCG Optimizer] Overlay now visible:", state.visible);
      sendResponse({ visible: state.visible });
      return true;
    }
  }
);

// Auto-initialize on cart pages
const isCartPage = window.location.pathname.startsWith("/cart");
console.log(`[TCG Optimizer] Content script loaded on ${window.location.pathname} (isCartPage: ${isCartPage})`);
if (isCartPage) {
  console.log("[TCG Optimizer] Auto-creating overlay on cart page");
  const { container } = createOverlay();
  overlayContainer = container;
  console.log("[TCG Optimizer] Overlay element:", document.getElementById("tcg-optimizer-overlay"));
  readCart();
}
