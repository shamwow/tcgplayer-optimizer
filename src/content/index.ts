import type { CartItem, CartSummary, ExtensionMessage } from "@/types";
import { matchCliOutputToItems, parseCliOptimizerOutput } from "@/cli/exchange";
import type { CliOptimizerOutput } from "@/cli/types";
import { replaceHtmlPreservingScroll } from "./render-utils";

/**
 * Content script injected on tcgplayer.com/cart pages.
 * Renders the optimizer overlay panel using Shadow DOM for style isolation.
 */

const OVERLAY_ID = "tcg-optimizer-overlay";
const SOLVE_COMMAND =
  "npm run solve --input <path_to_file_from_step_1> --output <path_to_output_file>";

interface ProgressState {
  stage: string;
  progress: number;
}

interface ImportedReviewItem {
  cartIndex: number;
  name: string;
  condition: string;
  printing: string;
  setName: string;
  oldSeller: string;
  newSeller: string;
  oldPriceCents: number;
  newPriceCents: number;
  keptCurrent: boolean;
}

interface ImportedReviewData {
  assignments: ImportedReviewItem[];
  itemCostCents: number;
  shippingCents: number;
  totalCostCents: number;
  sellerCount: number;
}

interface OverlayState {
  visible: boolean;
  error: string | null;
  cartLoaded: boolean;
  items: CartItem[];
  summary: CartSummary | null;
  cartExpanded: boolean;
  exportStage: "idle" | "exporting" | "done";
  exportProgress: ProgressState;
  exportedFilename: string | null;
  commandCopied: boolean;
  step3Unlocked: boolean;
  importStage: "idle" | "loading" | "loaded" | "applying";
  importProgress: ProgressState;
  importText: string;
  importedOutput: CliOptimizerOutput | null;
  reviewData: ImportedReviewData | null;
  reviewExpanded: boolean;
  pageItemCount: number;
}

let syncCheckInterval: ReturnType<typeof setInterval> | null = null;

const SYNC_CHECK_INTERVAL_MS = 3000;

function startSyncCheck() {
  if (syncCheckInterval) return;
  syncCheckInterval = setInterval(() => {
    if (state.importStage === "applying") return;
    const count = document.querySelectorAll('.package-item').length;
    if (count !== state.pageItemCount) {
      state.pageItemCount = count;
      render();
    }
  }, SYNC_CHECK_INTERVAL_MS);
}

function stopSyncCheck() {
  if (syncCheckInterval) {
    clearInterval(syncCheckInterval);
    syncCheckInterval = null;
  }
}

const state: OverlayState = {
  visible: true,
  error: null,
  cartLoaded: false,
  items: [],
  summary: null,
  cartExpanded: false,
  exportStage: "idle",
  exportProgress: { stage: "", progress: 0 },
  exportedFilename: null,
  commandCopied: false,
  step3Unlocked: false,
  importStage: "idle",
  importProgress: { stage: "", progress: 0 },
  importText: "",
  importedOutput: null,
  reviewData: null,
  reviewExpanded: false,
  pageItemCount: 0,
};

let overlayContainer: HTMLDivElement | null = null;

function createOverlay(): { root: ShadowRoot; container: HTMLDivElement } {
  document.getElementById(OVERLAY_ID)?.remove();

  const host = document.createElement("div");
  host.id = OVERLAY_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

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
      background: #eef2f7;
      border-left: 1px solid #d8e0ea;
      box-shadow: -6px 0 28px rgba(15, 23, 42, 0.18);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      color: #172033;
      display: flex;
      flex-direction: column;
      overflow: hidden;
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
      border-bottom: 1px solid rgba(255, 255, 255, 0.18);
      background: #1d4ed8;
      color: white;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    .panel-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .panel-header h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .close-btn {
      background: none;
      border: none;
      color: white;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      opacity: 0.82;
    }
    .close-btn:hover {
      opacity: 1;
    }
    .panel-body {
      padding: 14px;
      flex: 1;
      overflow-y: auto;
    }
    .status-text {
      color: #526075;
      font-size: 13px;
      text-align: center;
      padding: 24px 12px;
    }
    .error-box {
      background: #fff1f2;
      border: 1px solid #fecdd3;
      border-radius: 12px;
      padding: 11px 12px;
      margin-bottom: 12px;
      color: #be123c;
      font-size: 12px;
      line-height: 1.5;
    }
    .warning-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 12px;
      padding: 10px 12px;
      margin-bottom: 12px;
      color: #92400e;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .warning-reload-btn {
      background: #f59e0b;
      color: white;
      border: none;
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .warning-reload-btn:hover {
      background: #d97706;
    }
    .card {
      background: white;
      border: 1px solid #dbe4ef;
      border-radius: 16px;
      margin-bottom: 14px;
      overflow: hidden;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
      transition: border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    }
    .card-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px 12px;
      border-bottom: 1px solid #edf2f7;
      background: linear-gradient(180deg, #fbfdff 0%, #f7fafc 100%);
    }
    .card-body {
      padding: 16px;
    }
    .step-card.active {
      border-color: #3b82f6;
      box-shadow: 0 12px 30px rgba(37, 99, 235, 0.16);
    }
    .step-card.completed {
      border-color: #c7d7ee;
    }
    .step-card.disabled {
      background: #f7f9fc;
      border-color: #e2e8f0;
      opacity: 0.72;
      box-shadow: none;
    }
    .step-card.disabled .card-title {
      background: #f8fafc;
    }
    .step-card-title {
      padding-bottom: 14px;
    }
    .step-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
    }
    .step-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 58px;
      padding: 6px 10px;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .step-card.disabled .step-number {
      background: #e5e7eb;
      color: #6b7280;
    }
    .step-status {
      flex-shrink: 0;
      border-radius: 999px;
      padding: 5px 9px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: #eff6ff;
      color: #1d4ed8;
    }
    .step-card.completed .step-status {
      background: #ecfdf5;
      color: #15803d;
    }
    .step-card.disabled .step-status {
      background: #f1f5f9;
      color: #64748b;
    }
    .step-description {
      color: #526075;
      line-height: 1.55;
      margin-bottom: 14px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .stat-item {
      padding: 12px;
      border-radius: 12px;
      background: #f8fbff;
      border: 1px solid #e5edf6;
    }
    .stat-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #7c8aa0;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 16px;
      font-weight: 800;
      color: #172033;
    }
    .stat-value.highlight {
      color: #1d4ed8;
    }
    .summary-total {
      margin-top: 12px;
      padding: 12px 14px;
      border-radius: 12px;
      background: #eff6ff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-weight: 700;
      color: #1e3a8a;
    }
    .expandable-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
      padding: 0;
      background: none;
      border: none;
      width: 100%;
      text-align: left;
      color: #334155;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .expandable-chevron {
      transition: transform 0.2s ease;
      font-size: 10px;
      color: #64748b;
    }
    .expandable-chevron.open {
      transform: rotate(90deg);
    }
    .expandable-content {
      display: none;
      margin-top: 10px;
    }
    .expandable-content.open {
      display: block;
    }
    .results-table-wrapper {
      overflow-x: auto;
      border: 1px solid #e5edf6;
      border-radius: 12px;
      background: #fff;
    }
    .results-table {
      width: 100%;
      min-width: 480px;
      border-collapse: collapse;
      font-size: 11px;
    }
    .results-table th {
      background: #f8fbff;
      text-align: left;
      padding: 8px 10px;
      font-weight: 700;
      color: #475569;
      white-space: nowrap;
    }
    .results-table th.right {
      text-align: right;
    }
    .results-table td {
      padding: 7px 10px;
      border-top: 1px solid #edf2f7;
      white-space: nowrap;
    }
    .results-table td.right {
      text-align: right;
    }
    .results-table td.sub-detail {
      padding: 0 10px 7px;
      border-top: none;
      color: #94a3b8;
      font-size: 10px;
      word-break: break-word;
      white-space: normal;
    }
    .results-table td.sub-empty {
      padding: 0;
      border-top: none;
    }
    .price-cheaper {
      color: #15803d;
      font-weight: 700;
    }
    .price-same {
      color: #172033;
      font-weight: 700;
    }
    .price-more {
      color: #dc2626;
      font-weight: 700;
    }
    .kept-label {
      display: inline-block;
      margin-right: 6px;
      color: #64748b;
      font-size: 10px;
      font-style: italic;
    }
    .progress {
      margin-top: 14px;
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 11px;
      color: #5b6779;
      margin-bottom: 6px;
    }
    .progress-bar {
      height: 8px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .progress-fill {
      height: 100%;
      background: #2563eb;
      border-radius: 999px;
      transition: width 0.25s ease;
    }
    .card-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 14px;
    }
    .card-actions.two-up {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .copy-btn,
    .secondary-btn {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }
    .copy-btn {
      background: #1d4ed8;
      color: white;
      border: 1px solid #1d4ed8;
    }
    .copy-btn:hover:not(:disabled) {
      background: #1e40af;
      border-color: #1e40af;
    }
    .secondary-btn {
      background: white;
      color: #1e293b;
      border: 1px solid #cbd5e1;
    }
    .secondary-btn:hover:not(:disabled) {
      background: #f8fafc;
      border-color: #94a3b8;
    }
    .copy-btn:disabled,
    .secondary-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }
    .step-note {
      margin-top: 12px;
      color: #526075;
      font-size: 12px;
      line-height: 1.5;
    }
    .muted-text {
      color: #64748b;
      font-size: 12px;
      line-height: 1.55;
    }
    .command-box {
      padding: 12px 14px;
      border-radius: 12px;
      background: #0f172a;
      color: #e2e8f0;
      border: 1px solid #1e293b;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.55;
      word-break: break-word;
    }
    .drop-zone {
      border: 2px dashed #93c5fd;
      border-radius: 14px;
      padding: 18px 16px;
      background: #f8fbff;
      text-align: center;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .drop-zone.drag-over {
      border-color: #1d4ed8;
      background: #eff6ff;
    }
    .drop-zone-title {
      font-size: 13px;
      font-weight: 700;
      color: #172033;
      margin-bottom: 6px;
    }
    .drop-zone-subtitle {
      font-size: 12px;
      color: #64748b;
      margin-bottom: 12px;
    }
    .step-separator {
      margin: 14px 0 10px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #94a3b8;
    }
    .import-textarea {
      width: 100%;
      min-height: 120px;
      padding: 12px;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      resize: vertical;
      box-sizing: border-box;
      color: #172033;
      background: white;
    }
    .import-textarea:focus {
      outline: none;
      border-color: #60a5fa;
      box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.15);
    }
    @media (max-width: 640px) {
      #tcg-optimizer-root {
        width: 100vw;
      }
      .card-actions.two-up {
        grid-template-columns: 1fr;
      }
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function render() {
  if (!overlayContainer) {
    return;
  }

  overlayContainer.className = state.visible ? "" : "hidden";
  overlayContainer.id = "tcg-optimizer-root";

  let html = `
    <div class="panel-header">
      <div class="panel-header-left">
        <svg width="22" height="22" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M88.7774 21.7025C89.9579 18.9613 89.0776 15.76 86.6566 13.9993C84.2356 12.2385 80.9342 12.3986 78.6733 14.3594L27.452 59.178C25.4512 60.9387 24.7309 63.7599 25.6713 66.2409C26.6117 68.722 29.0127 70.4026 31.6738 70.4026H53.983L38.5966 106.298C37.4162 109.039 38.2965 112.24 40.7175 114.001C43.1385 115.761 46.4399 115.601 48.7008 113.641L99.9221 68.822C101.923 67.0613 102.643 64.2401 101.703 61.7591C100.762 59.278 98.3814 57.6174 95.7003 57.6174H73.3911L88.7774 21.7025Z" fill="#FBBF24"/>
        </svg>
        <h1>Cart Optimizer</h1>
      </div>
      <button class="close-btn" id="tcg-opt-close" aria-label="Close optimizer">&times;</button>
    </div>
    <div class="panel-body">
  `;

  if (state.error) {
    html += `<div class="error-box">${escHtml(state.error)}</div>`;
  }

  if (state.cartLoaded && state.items.length > 0) {
    if (state.pageItemCount > 0 && state.pageItemCount !== state.items.length) {
      html += `
        <div class="warning-box">
          <span>Cart may be out of sync with the page.</span>
          <button class="warning-reload-btn" id="tcg-opt-reload">Reload</button>
        </div>
      `;
    }
  }

  if (!state.cartLoaded) {
    html += `<div class="status-text">Reading cart...</div>`;
  } else if (state.items.length === 0) {
    html += `<div class="status-text">Your cart is empty. Add items to your cart and reload.</div>`;
  } else {
    html += renderStepCard({
      step: 1,
      title: "Export Cart",
      description:
        "Download the current cart, listings, and seller threshold data that the solver needs.",
      active: getCurrentStep() === 1,
      disabled: false,
      completed: state.exportStage === "done",
      body: renderExportStepBody(),
    });
    html += renderStepCard({
      step: 2,
      title: "Run Solver",
      description:
        "Run the exact solver locally from your terminal to generate the optimal cart output file.",
      active: getCurrentStep() === 2,
      disabled: !state.exportedFilename,
      completed: state.step3Unlocked,
      body: renderSolverStepBody(),
    });
    html += renderStepCard({
      step: 3,
      title: "Import And Review",
      description:
        "Load the solver output, review the new cart assignments, then apply the changes.",
      active: getCurrentStep() === 3,
      disabled: !state.step3Unlocked,
      completed: state.importStage === "loaded",
      body: renderImportReviewStepBody(),
    });
  }

  html += `</div>`;
  replaceHtmlPreservingScroll(overlayContainer, html);
  bindEvents();
}

function getCurrentCartMetrics() {
  const itemCount =
    state.summary?.itemCount ??
    state.items.reduce((sum, item) => sum + Math.max(item.quantity, 1), 0);
  const sellerCount =
    state.summary?.sellerCount ??
    new Set(
      state.items.map((item) => item.currentSellerKey || item.currentSeller || `seller-${item.cartIndex}`)
    ).size;
  const shippingCents = state.summary?.shippingCostCents ?? null;
  const fallbackItemCostCents = state.items.reduce(
    (sum, item) => sum + item.currentPriceCents,
    0
  );
  const itemCostCents =
    state.summary?.cartCostCents !== undefined && shippingCents !== null
      ? state.summary.cartCostCents - shippingCents
      : fallbackItemCostCents;
  const totalCostCents = state.summary?.cartCostCents ?? itemCostCents;

  return { itemCount, sellerCount, itemCostCents, shippingCents, totalCostCents };
}

function getCurrentStep(): 1 | 2 | 3 {
  if (state.exportStage === "exporting" || !state.exportedFilename) {
    return 1;
  }
  if (!state.step3Unlocked) {
    return 2;
  }
  return 3;
}

function renderStepCard(args: {
  step: 1 | 2 | 3;
  title: string;
  description: string;
  active: boolean;
  disabled: boolean;
  completed: boolean;
  body: string;
}): string {
  const classes = ["card", "step-card"];
  if (args.active) {
    classes.push("active");
  }
  if (args.disabled) {
    classes.push("disabled");
  }
  if (args.completed) {
    classes.push("completed");
  }

  const status = args.disabled
    ? ""
    : args.active
      ? "Current"
      : args.completed
        ? "Complete"
        : "Ready";

  return `
    <div class="${classes.join(" ")}">
      <div class="card-title step-card-title">
        <div class="step-title-row">
          <span class="step-number">Step ${args.step}</span>
          <span>${escHtml(args.title)}</span>
        </div>
        ${status ? `<span class="step-status">${status}</span>` : ""}
      </div>
      <div class="card-body">
        <div class="step-description">${escHtml(args.description)}</div>
        ${args.body}
      </div>
    </div>
  `;
}

function renderProgress(progress: ProgressState): string {
  const pct = Math.max(0, Math.min(100, Math.round(progress.progress * 100)));

  return `
    <div class="progress">
      <div class="progress-info">
        <span>${escHtml(progress.stage)}</span>
        <span>${pct}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

function renderStatsSummary(metrics: {
  sellerCount: number;
  itemCount: number;
  itemCostCents: number;
  shippingCents: number | null;
  totalCostCents: number;
}): string {
  return `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-label">Packages</div>
        <div class="stat-value">${metrics.sellerCount}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Items</div>
        <div class="stat-value">${metrics.itemCount}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Cart Cost</div>
        <div class="stat-value">${fmt(metrics.itemCostCents)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Shipping</div>
        <div class="stat-value">${metrics.shippingCents !== null ? fmt(metrics.shippingCents) : "-"}</div>
      </div>
    </div>
    <div class="summary-total">
      <span>Total</span>
      <span class="stat-value highlight">${fmt(metrics.totalCostCents)}</span>
    </div>
  `;
}

function renderCurrentItemsAccordion(): string {
  const sortedItems = [...state.items].sort((a, b) => a.name.localeCompare(b.name));

  let html = `
    <button class="expandable-trigger" id="tcg-opt-expand-cart">
      <span>View all ${state.items.length} items</span>
      <span class="expandable-chevron ${state.cartExpanded ? "open" : ""}">&#9654;</span>
    </button>
    <div class="expandable-content ${state.cartExpanded ? "open" : ""}">
      <div class="results-table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Condition</th>
              <th>Seller</th>
              <th class="right">Price</th>
            </tr>
          </thead>
          <tbody>
  `;

  for (const item of sortedItems) {
    html += `
      <tr>
        <td title="${escHtml(item.name)}">${escHtml(item.name)}</td>
        <td>${renderConditionText(item.condition, item.printing)}</td>
        <td>${escHtml(item.currentSeller || "-")}</td>
        <td class="right" style="font-weight:700">${fmt(item.currentPriceCents)}</td>
      </tr>
      <tr>
        <td class="sub-detail">${escHtml(item.setName)}</td>
        <td class="sub-empty"></td>
        <td class="sub-empty"></td>
        <td class="sub-empty"></td>
      </tr>
    `;
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  return html;
}

function renderReviewAccordion(review: ImportedReviewData): string {
  const sortedAssignments = [...review.assignments].sort((a, b) => a.name.localeCompare(b.name));

  let html = `
    <button class="expandable-trigger" id="tcg-opt-expand-review">
      <span>View all ${review.assignments.length} items</span>
      <span class="expandable-chevron ${state.reviewExpanded ? "open" : ""}">&#9654;</span>
    </button>
    <div class="expandable-content ${state.reviewExpanded ? "open" : ""}">
      <div class="results-table-wrapper">
        <table class="results-table">
          <thead>
            <tr>
              <th>Card</th>
              <th>Condition</th>
              <th>Old Seller</th>
              <th>New Seller</th>
              <th class="right">Old</th>
              <th class="right">New</th>
            </tr>
          </thead>
          <tbody>
  `;

  for (const item of sortedAssignments) {
    const priceClass = item.keptCurrent
      ? "price-same"
      : item.newPriceCents < item.oldPriceCents
        ? "price-cheaper"
        : item.newPriceCents > item.oldPriceCents
          ? "price-more"
          : "price-same";

    html += `
      <tr>
        <td>${item.keptCurrent ? `<span class="kept-label">Kept</span>` : ""}${escHtml(item.name)}</td>
        <td>${renderConditionText(item.condition, item.printing)}</td>
        <td>${escHtml(item.oldSeller || "-")}</td>
        <td>${escHtml(item.newSeller || "-")}</td>
        <td class="right">${fmt(item.oldPriceCents)}</td>
        <td class="right ${priceClass}">${fmt(item.newPriceCents)}</td>
      </tr>
      <tr>
        <td class="sub-detail">${escHtml(item.setName)}</td>
        <td class="sub-empty"></td>
        <td class="sub-empty"></td>
        <td class="sub-empty"></td>
        <td class="sub-empty"></td>
        <td class="sub-empty"></td>
      </tr>
    `;
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  return html;
}

function renderExportStepBody(): string {
  let html = renderStatsSummary(getCurrentCartMetrics());
  html += renderCurrentItemsAccordion();

  if (state.exportStage === "exporting") {
    html += renderProgress(state.exportProgress);
  }

  if (state.exportedFilename) {
    html += `<div class="step-note">Latest export: ${escHtml(state.exportedFilename)}</div>`;
  }

  html += `
    <div class="card-actions">
      <button class="copy-btn" id="tcg-step1-export" ${state.exportStage === "exporting" ? "disabled" : ""}>
        ${state.exportStage === "done" ? "Download Cart Export Again" : "Download Cart Export"}
      </button>
    </div>
  `;

  return html;
}

function renderSolverStepBody(): string {
  if (!state.exportedFilename) {
    return ``;
  }

  return `
    <div class="command-box">${escHtml(SOLVE_COMMAND)}</div>
    <div class="step-note">
      Use the JSON file downloaded in Step 1 as the input path, then point the output to a new JSON file.
    </div>
    <div class="card-actions two-up">
      <button class="secondary-btn" id="tcg-step2-copy-command">${state.commandCopied ? "Copied!" : "Copy Command"}</button>
      <button class="copy-btn" id="tcg-step2-continue">${state.step3Unlocked ? "Import Ready" : "Continue To Import"}</button>
    </div>
  `;
}

function renderImportReviewStepBody(): string {
  if (!state.step3Unlocked) {
    return "";
  }

  let html = "";

  if (state.importStage === "loading" || state.importStage === "applying") {
    html += renderProgress(state.importProgress);
  }

  if (state.reviewData) {
    html += renderStatsSummary({
      sellerCount: state.reviewData.sellerCount,
      itemCount: state.reviewData.assignments.length,
      itemCostCents: state.reviewData.itemCostCents,
      shippingCents: state.reviewData.shippingCents,
      totalCostCents: state.reviewData.totalCostCents,
    });
    html += renderReviewAccordion(state.reviewData);
    html += `
      <div class="card-actions two-up">
        <button class="copy-btn" id="tcg-step3-apply" ${state.importStage === "applying" ? "disabled" : ""}>Apply Changes</button>
        <button class="secondary-btn" id="tcg-step3-clear" ${state.importStage === "applying" ? "disabled" : ""}>Clear Input</button>
      </div>
    `;

    return html;
  }

  html += `
    <div class="drop-zone" id="tcg-step3-drop-zone">
      <div class="drop-zone-title">Drag and drop the solver output JSON here</div>
      <div class="drop-zone-subtitle">or choose a file from disk</div>
      <button class="secondary-btn" id="tcg-step3-choose-file" ${state.importStage === "loading" ? "disabled" : ""}>Choose File</button>
      <input type="file" id="tcg-step3-file-input" accept="application/json,.json" style="display:none" />
    </div>
    <div class="step-separator">or paste the output</div>
    <textarea class="import-textarea" id="tcg-step3-paste-input" placeholder="Paste solver output JSON here">${escHtml(state.importText)}</textarea>
    <div class="card-actions">
      <button class="copy-btn" id="tcg-step3-load-pasted" ${state.importStage === "loading" ? "disabled" : ""}>Load Review</button>
    </div>
  `;

  return html;
}

function renderConditionText(condition: string, printing: string): string {
  const includePrinting =
    printing &&
    printing !== "Normal" &&
    !condition.toLowerCase().includes(printing.toLowerCase());

  return `${escHtml(condition)}${includePrinting ? ` ${escHtml(printing)}` : ""}`;
}

function bindEvents() {
  if (!overlayContainer) {
    return;
  }

  overlayContainer.querySelector("#tcg-opt-close")?.addEventListener("click", () => {
    state.visible = false;
    chrome.storage.local.set({ overlayDismissed: true });
    render();
  });

  overlayContainer.querySelector("#tcg-opt-reload")?.addEventListener("click", () => {
    window.location.reload();
  });

  overlayContainer.querySelector("#tcg-opt-expand-cart")?.addEventListener("click", () => {
    state.cartExpanded = !state.cartExpanded;
    render();
  });

  overlayContainer.querySelector("#tcg-opt-expand-review")?.addEventListener("click", () => {
    state.reviewExpanded = !state.reviewExpanded;
    render();
  });

  overlayContainer.querySelector("#tcg-step1-export")?.addEventListener("click", () => {
    void exportCliInput();
  });

  overlayContainer.querySelector("#tcg-step2-copy-command")?.addEventListener("click", () => {
    void copySolverCommand();
  });

  overlayContainer.querySelector("#tcg-step2-continue")?.addEventListener("click", () => {
    state.step3Unlocked = true;
    state.error = null;
    render();
  });

  overlayContainer.querySelector("#tcg-step3-choose-file")?.addEventListener("click", () => {
    const fileInput = overlayContainer?.querySelector(
      "#tcg-step3-file-input"
    ) as HTMLInputElement | null;
    fileInput?.click();
  });

  overlayContainer.querySelector("#tcg-step3-file-input")?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void loadCliOutputFile(file);
    }
    input.value = "";
  });

  const dropZone = overlayContainer.querySelector("#tcg-step3-drop-zone") as HTMLDivElement | null;
  if (dropZone) {
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        void loadCliOutputFile(file);
      }
    });
  }

  overlayContainer.querySelector("#tcg-step3-paste-input")?.addEventListener("input", (event) => {
    state.importText = (event.target as HTMLTextAreaElement).value;
  });

  overlayContainer.querySelector("#tcg-step3-load-pasted")?.addEventListener("click", () => {
    if (!state.importText.trim()) {
      state.error = "Paste the solver output JSON before loading the review.";
      render();
      return;
    }

    void loadCliOutputText(state.importText.trim());
  });

  overlayContainer.querySelector("#tcg-step3-apply")?.addEventListener("click", () => {
    void applyImportedOutput();
  });

  overlayContainer.querySelector("#tcg-step3-clear")?.addEventListener("click", () => {
    clearImportedReview();
  });
}

async function copySolverCommand() {
  try {
    await navigator.clipboard.writeText(SOLVE_COMMAND);
    state.commandCopied = true;
    state.error = null;
    render();
    window.setTimeout(() => {
      state.commandCopied = false;
      render();
    }, 2000);
  } catch {
    state.error = "Could not copy the solver command to the clipboard.";
    render();
  }
}

function downloadJsonFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportCliInput() {
  if (state.items.length === 0) {
    return;
  }

  state.error = null;
  state.exportStage = "exporting";
  state.exportProgress = { stage: "Preparing export...", progress: 0 };
  render();

  try {
    const response = await sendExtensionMessage({
      type: "EXPORT_CLI_INPUT",
      items: state.items,
      verifiedOnly: true,
    });

    if (response.type !== "EXPORT_CLI_INPUT_RESULT") {
      if (response.type === "OPTIMIZATION_ERROR") {
        throw new Error(response.error);
      }
      throw new Error("Failed to export the cart.");
    }

    const filename = `tcg-optimizer-cli-input-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    downloadJsonFile(filename, response.data);

    state.exportStage = "done";
    state.exportProgress = { stage: "Download ready", progress: 1 };
    state.exportedFilename = filename;
    state.commandCopied = false;
    state.step3Unlocked = false;
    state.importStage = "idle";
    state.importProgress = { stage: "", progress: 0 };
    state.importText = "";
    state.importedOutput = null;
    state.reviewData = null;
    state.reviewExpanded = false;
    state.error = null;
    render();
  } catch (err) {
    state.exportStage = "idle";
    state.exportProgress = { stage: "", progress: 0 };
    state.error = err instanceof Error ? err.message : "Failed to export the cart.";
    render();
  }
}

async function loadCliOutputFile(file: File) {
  state.error = null;
  state.importStage = "loading";
  state.importProgress = { stage: `Reading ${file.name}...`, progress: 0.08 };
  render();

  try {
    const text = await readFileAsText(file);
    state.importText = text;
    await loadCliOutputText(text, file.name);
  } catch (err) {
    state.importStage = "idle";
    state.importProgress = { stage: "", progress: 0 };
    state.error =
      err instanceof Error ? err.message : "Failed to read the solver output file.";
    render();
  }
}

async function loadCliOutputText(raw: string, sourceLabel: string = "pasted output") {
  state.error = null;
  state.importStage = "loading";
  state.importProgress = { stage: `Parsing ${sourceLabel}...`, progress: 0.55 };
  render();

  try {
    const output = parseCliOptimizerOutput(raw);
    state.importProgress = { stage: "Building review...", progress: 0.82 };
    render();

    const reviewData = buildImportedReview(output);
    state.importedOutput = output;
    state.reviewData = reviewData;
    state.importStage = "loaded";
    state.importProgress = { stage: "Review ready", progress: 1 };
    state.step3Unlocked = true;
    state.reviewExpanded = false;
    state.error = null;
    render();
  } catch (err) {
    state.importStage = "idle";
    state.importProgress = { stage: "", progress: 0 };
    state.error = err instanceof Error ? err.message : "Failed to load the solver output.";
    render();
  }
}

function buildImportedReview(output: CliOptimizerOutput): ImportedReviewData {
  const matchedAssignments = matchCliOutputToItems(state.items, output);
  const reviewItems: ImportedReviewItem[] = [];
  let extraCurrentCost = 0;

  for (const { item, assignment } of matchedAssignments) {
    const keptCurrent = !assignment;
    const newPriceCents = assignment?.priceCents ?? item.currentPriceCents;

    if (keptCurrent) {
      extraCurrentCost += item.currentPriceCents;
    }

    reviewItems.push({
      cartIndex: item.cartIndex,
      name: item.name,
      condition: item.condition,
      printing: item.printing,
      setName: item.setName,
      oldSeller: item.currentSeller || "(current seller)",
      newSeller:
        assignment?.sellerName ||
        assignment?.sellerKey ||
        (assignment ? `Seller ${assignment.sellerId}` : item.currentSeller || "(current seller)"),
      oldPriceCents: item.currentPriceCents,
      newPriceCents,
      keptCurrent,
    });
  }

  const sellerCount = new Set(
    matchedAssignments.map(
      ({ item, assignment }) =>
        assignment?.sellerKey || item.currentSellerKey || item.currentSeller || `seller-${item.cartIndex}`
    )
  ).size;

  return {
    assignments: reviewItems,
    itemCostCents: output.itemCostCents + extraCurrentCost,
    shippingCents: output.shippingCents,
    totalCostCents: output.objectiveCents + extraCurrentCost,
    sellerCount,
  };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}.`));
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        state.importProgress = {
          stage: `Reading ${file.name}...`,
          progress: 0.08 + (event.loaded / event.total) * 0.34,
        };
        render();
      }
    };

    reader.readAsText(file);
  });
}

async function applyImportedOutput() {
  const importedOutput = state.importedOutput;
  if (!importedOutput) {
    return;
  }

  state.error = null;
  state.importStage = "applying";
  state.importProgress = { stage: "Applying cart changes...", progress: 0 };
  render();

  try {
    const response = await sendExtensionMessage({
      type: "APPLY_CLI_OUTPUT",
      items: state.items,
      output: importedOutput,
    });

    if (response.type === "UPDATE_CART_RESULT" && response.success) {
      state.importProgress = { stage: "Cart updated", progress: 1 };
      render();
      window.setTimeout(() => window.location.reload(), 1500);
      return;
    }

    if (response.type === "UPDATE_CART_RESULT") {
      throw new Error(response.error ?? "Failed to apply the solver output.");
    }

    if (response.type === "OPTIMIZATION_ERROR") {
      throw new Error(response.error);
    }

    throw new Error("Failed to apply the solver output.");
  } catch (err) {
    state.importStage = "loaded";
    state.importProgress = { stage: "", progress: 0 };
    state.error =
      err instanceof Error ? err.message : "Failed to apply the solver output.";
    render();
  }
}

function clearImportedReview() {
  state.importStage = "idle";
  state.importProgress = { stage: "", progress: 0 };
  state.importText = "";
  state.importedOutput = null;
  state.reviewData = null;
  state.reviewExpanded = false;
  state.error = null;
  render();
}

function escHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

async function sendExtensionMessage(message: ExtensionMessage): Promise<ExtensionMessage> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response?: ExtensionMessage) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response) {
        reject(new Error("No response received from the extension."));
        return;
      }

      resolve(response);
    });
  });
}

function resetWizardState() {
  state.cartExpanded = false;
  state.exportStage = "idle";
  state.exportProgress = { stage: "", progress: 0 };
  state.exportedFilename = null;
  state.commandCopied = false;
  state.step3Unlocked = false;
  state.importStage = "idle";
  state.importProgress = { stage: "", progress: 0 };
  state.importText = "";
  state.importedOutput = null;
  state.reviewData = null;
  state.reviewExpanded = false;
}

async function readCart() {
  state.cartLoaded = false;
  state.error = null;
  resetWizardState();
  render();

  try {
    const response = await sendExtensionMessage({ type: "READ_CART" });

    if (response.type === "CART_DATA") {
      state.items = response.items;
      state.summary = response.summary;
      state.cartLoaded = true;
      render();
      return;
    }

    if (response.type === "OPTIMIZATION_ERROR") {
      state.error = response.error;
      state.cartLoaded = true;
      render();
      return;
    }

    state.error = "Could not read cart.";
    state.cartLoaded = true;
    render();
  } catch (err) {
    state.error =
      err instanceof Error
        ? err.message
        : "Could not connect to the extension. Try reloading the page.";
    state.cartLoaded = true;
    render();
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "EXPORT_CLI_INPUT_PROGRESS" && state.exportStage === "exporting") {
    state.exportProgress = { stage: message.stage, progress: message.progress };
    render();
    return;
  }

  if (message.type === "UPDATE_CART_PROGRESS" && state.importStage === "applying") {
    state.importProgress = { stage: message.stage, progress: message.progress };
    render();
  }
});

chrome.runtime.onMessage.addListener(
  (message: { type: string }, _sender, sendResponse) => {
    if (message.type !== "TOGGLE_OVERLAY") {
      return;
    }

    if (!overlayContainer) {
      const { container } = createOverlay();
      overlayContainer = container;
      state.visible = true;
      chrome.storage.local.remove("overlayDismissed");
      startSyncCheck();
      void readCart();
    } else {
      state.visible = !state.visible;
      if (state.visible) {
        chrome.storage.local.remove("overlayDismissed");
        startSyncCheck();
      } else {
        chrome.storage.local.set({ overlayDismissed: true });
        stopSyncCheck();
      }
      render();
    }

    sendResponse({ visible: state.visible });
    return true;
  }
);

const isCartPage = window.location.pathname.startsWith("/cart");

if (isCartPage) {
  chrome.storage.local.get("overlayDismissed", (result) => {
    if (result.overlayDismissed) {
      return;
    }

    const { container } = createOverlay();
    overlayContainer = container;
    startSyncCheck();
    void readCart();
  });
}
