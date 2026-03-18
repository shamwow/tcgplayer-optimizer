import type {
  CartItem,
  SellerListing,
  CardAssignment,
  SellerSummary,
  SkippedCard,
  OptimizationResult,
  ExtensionMessage,
} from "@/types";
import type { ModelInput, ListingForModel, SolverResult } from "@/optimizer/types";
import type { CartSummary } from "@/types";
import { fetchListings } from "@/api/tcgplayer";
import { getCartKey, fetchCartItems, getCartSummary } from "@/api/cart";

/**
 * Background service worker: orchestrates the optimization pipeline.
 * Cart reading (via API) → Listings → Solver → Results
 */
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "READ_CART") {
      handleReadCart(sendResponse);
      return true; // async
    }
    if (message.type === "OPTIMIZE") {
      handleOptimize(message.items, message.verifiedOnly, sendResponse);
      return true; // async
    }
  }
);

// Toggle overlay when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  console.log("[TCG Optimizer SW] Icon clicked, tab:", tab.id, tab.url);
  if (!tab.id) return;

  // Check if we're on a TCGPlayer page
  if (!tab.url?.includes("tcgplayer.com")) {
    console.log("[TCG Optimizer SW] Not on TCGPlayer, navigating to cart");
    chrome.tabs.update(tab.id, { url: "https://www.tcgplayer.com/cart" });
    return;
  }

  // Toggle the overlay via content script
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_OVERLAY" });
    console.log("[TCG Optimizer SW] Toggle response:", resp);
  } catch (err) {
    console.log("[TCG Optimizer SW] Content script not responding, trying injection:", err);
    try {
      // Inject content script programmatically
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content/index.ts"],
      });
      console.log("[TCG Optimizer SW] Script injected successfully");
    } catch (injectErr) {
      console.error("[TCG Optimizer SW] Script injection failed:", injectErr);
    }
  }
});

async function handleReadCart(sendResponse: (msg: ExtensionMessage) => void) {
  try {
    // Try getting cart key from cookie first (works for both logged-in and anonymous)
    let cartKey = await getCartKeyFromCookie();
    console.log("[TCG Optimizer SW] Cart key from cookie:", cartKey);

    // Fall back to user API (for logged-in users whose cookie might differ)
    if (!cartKey) {
      cartKey = await getCartKey();
      console.log("[TCG Optimizer SW] Cart key from user API:", cartKey);
    }

    if (!cartKey) {
      console.log("[TCG Optimizer SW] No cart key found, returning empty");
      sendResponse({
        type: "CART_DATA",
        items: [],
        summary: null,
      });
      return;
    }

    console.log("[TCG Optimizer SW] Fetching cart items for key:", cartKey);
    const [items, rawSummary] = await Promise.all([
      fetchCartItems(cartKey),
      getCartSummary(cartKey).catch(() => null),
    ]);
    console.log(`[TCG Optimizer SW] Fetched ${items.length} cart items`);

    let summary: CartSummary | null = null;
    if (rawSummary) {
      summary = {
        itemCount: rawSummary.itemCount,
        sellerCount: rawSummary.fulfillerCount,
        cartCostCents: Math.round(rawSummary.requestedTotalCost * 100),
        shippingCostCents: Math.round(rawSummary.estimatedShippingCost * 100),
      };
    }

    sendResponse({ type: "CART_DATA", items, summary });
  } catch (err) {
    console.error("[TCG Optimizer SW] handleReadCart error:", err);
    sendResponse({
      type: "OPTIMIZATION_ERROR",
      error: err instanceof Error ? err.message : "Failed to read cart",
    });
  }
}

async function getCartKeyFromCookie(): Promise<string | null> {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://www.tcgplayer.com",
      name: "StoreCart_PRODUCTION",
    });

    if (!cookie?.value) return null;

    // Cookie value format: CK=<cartKey>&Ignore=false
    const match = cookie.value.match(/CK=([a-f0-9]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function handleOptimize(
  items: CartItem[],
  verifiedOnly: boolean,
  sendResponse: (msg: ExtensionMessage) => void
) {
  try {
    console.log(`[TCG Optimizer SW] Starting optimization for ${items.length} items (verifiedOnly: ${verifiedOnly})`);
    const startTime = performance.now();

    // Step 1: Fetch listings for all cards (in parallel batches)
    sendProgress("Fetching listings...", 0);
    const allListings = await fetchAllListings(items);
    console.log(`[TCG Optimizer SW] Fetched listings in ${Math.round(performance.now() - startTime)}ms`);

    // Step 1.5: Filter by verified sellers if requested
    if (verifiedOnly) {
      for (const [productId, listings] of allListings) {
        allListings.set(productId, listings.filter((l) => l.verified));
      }
      console.log(`[TCG Optimizer SW] Filtered to verified sellers only`);
    }

    // Step 2: Identify skipped cards (no listings found)
    const skippedCards: SkippedCard[] = [];
    const optimizableItems: CartItem[] = [];
    for (const item of items) {
      const listings = allListings.get(item.productId) ?? [];
      if (listings.length === 0) {
        skippedCards.push({
          name: item.name,
          condition: item.condition,
          printing: item.printing,
          reason: "No other listings found with given filters. Keeping original cart item.",
        });
        console.warn(`[TCG Optimizer SW] Skipping "${item.name}" — no listings for ${item.condition} / ${item.printing}`);
      } else {
        optimizableItems.push(item);
      }
    }

    if (optimizableItems.length === 0) {
      sendResponse({
        type: "OPTIMIZATION_ERROR",
        error: `No listings found for any of the ${items.length} cards. ${skippedCards.length} cards were skipped. Check condition/printing values in your cart.`,
      });
      return;
    }

    console.log(`[TCG Optimizer SW] ${optimizableItems.length} optimizable, ${skippedCards.length} skipped`);

    // Step 3: Build model and solve (only for cards with listings)
    sendProgress("Solving optimization...", 0.6, "Building model and sending to solver...");
    console.log("[TCG Optimizer SW] Building model and solving via offscreen document...");
    const modelInput = buildModelInput(optimizableItems, allListings);
    const solverResult = await solveViaOffscreen(modelInput);
    console.log(`[TCG Optimizer SW] Solver result: ${solverResult.status} in ${solverResult.solveTimeMs}ms`);

    if (solverResult.status !== "Optimal") {
      sendResponse({
        type: "OPTIMIZATION_ERROR",
        error: solverResult.errorMessage ?? "Solver did not find optimal solution",
      });
      return;
    }

    // Step 4: Map solver result back to domain types
    sendProgress("Building results...", 0.9);
    const result = buildOptimizationResult(
      optimizableItems,
      allListings,
      solverResult.chosenListings,
      solverResult.solveTimeMs
    );
    result.skippedCards = skippedCards;

    // Step 5: Inject skipped cards back into results with original cart data
    let skippedTotalCents = 0;
    for (const item of items) {
      const listings = allListings.get(item.productId) ?? [];
      if (listings.length === 0) {
        result.assignments.push({
          cartIndex: item.cartIndex,
          productId: item.productId,
          name: item.name,
          listing: {
            listingId: "current",
            productId: item.productId,
            sellerName: item.currentSeller || "(current seller)",
            sellerKey: "current",
            priceCents: item.currentPriceCents,
            quantity: item.quantity,
            shippingCents: 0,
            verified: false,
            condition: item.condition,
            printing: item.printing,
          },
          originalPriceCents: item.currentPriceCents,
          savingsCents: 0,
        });
        skippedTotalCents += item.currentPriceCents;
      }
    }
    result.totalCostCents += skippedTotalCents;
    result.originalTotalCents += skippedTotalCents;

    console.log(`[TCG Optimizer SW] Optimization complete. Savings: $${(result.savingsCents / 100).toFixed(2)}, ${skippedCards.length} skipped, total time: ${Math.round(performance.now() - startTime)}ms`);
    sendResponse({ type: "OPTIMIZATION_RESULT", result });
  } catch (err) {
    console.error("[TCG Optimizer SW] handleOptimize error:", err);
    sendResponse({
      type: "OPTIMIZATION_ERROR",
      error: err instanceof Error ? err.message : "Optimization failed",
    });
  }
}

/** Concurrency limit for parallel listing fetches */
const FETCH_CONCURRENCY = 5;

async function fetchAllListings(
  items: CartItem[]
): Promise<Map<number, SellerListing[]>> {
  const listingsMap = new Map<number, SellerListing[]>();

  // Deduplicate by productId (same card might appear multiple times)
  const uniqueItems = new Map<number, CartItem>();
  for (const item of items) {
    if (!uniqueItems.has(item.productId)) {
      uniqueItems.set(item.productId, item);
    }
  }

  const queue = Array.from(uniqueItems.values());
  let completed = 0;

  // Process in parallel batches
  async function processItem(item: CartItem) {
    try {
      sendProgress(
        `Fetching listings... (${completed}/${queue.length})`,
        (completed / queue.length) * 0.6,
        `Fetching "${item.name}" (${item.condition} / ${item.printing}, product ${item.productId})`
      );
      const listings = await fetchListings(
        item.productId,
        item.condition,
        item.printing
      );
      listingsMap.set(item.productId, listings);
      completed++;
      sendProgress(
        `Fetching listings... (${completed}/${queue.length})`,
        (completed / queue.length) * 0.6,
        `"${item.name}" → ${listings.length} listings`
      );
    } catch (err) {
      console.error(`[TCG Optimizer SW] Failed to fetch listings for "${item.name}":`, err);
      listingsMap.set(item.productId, []);
      completed++;
      sendProgress(
        `Fetching listings... (${completed}/${queue.length})`,
        (completed / queue.length) * 0.6,
        `"${item.name}" → ERROR: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Run with concurrency limit
  const executing = new Set<Promise<void>>();
  for (const item of queue) {
    const p = processItem(item);
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= FETCH_CONCURRENCY) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);

  return listingsMap;
}

function buildModelInput(
  items: CartItem[],
  allListings: Map<number, SellerListing[]>
): ModelInput {
  return {
    cards: items.map((item) => ({
      cartIndex: item.cartIndex,
      productId: item.productId,
      name: item.name,
      currentPriceCents: item.currentPriceCents,
    })),
    listingsPerCard: items.map((item) => {
      const listings = allListings.get(item.productId) ?? [];
      return listings.map(
        (l): ListingForModel => ({
          listingId: l.listingId,
          sellerKey: l.sellerKey,
          priceCents: l.priceCents,
          shippingCents: l.shippingCents,
        })
      );
    }),
  };
}

function buildOptimizationResult(
  items: CartItem[],
  allListings: Map<number, SellerListing[]>,
  chosenListings: Map<number, string>,
  solveTimeMs: number
): OptimizationResult {
  const assignments: CardAssignment[] = [];
  const sellerMap = new Map<string, CardAssignment[]>();

  // Build a lookup: listingId → SellerListing
  const listingLookup = new Map<string, SellerListing>();
  for (const listings of allListings.values()) {
    for (const listing of listings) {
      listingLookup.set(listing.listingId, listing);
    }
  }

  for (let cardIdx = 0; cardIdx < items.length; cardIdx++) {
    const item = items[cardIdx];
    const listingId = chosenListings.get(cardIdx);
    if (!listingId) continue;

    const listing = listingLookup.get(listingId);
    if (!listing) continue;

    const assignment: CardAssignment = {
      cartIndex: item.cartIndex,
      productId: item.productId,
      name: item.name,
      listing,
      originalPriceCents: item.currentPriceCents,
      savingsCents: item.currentPriceCents - listing.priceCents,
    };

    assignments.push(assignment);

    if (!sellerMap.has(listing.sellerKey)) {
      sellerMap.set(listing.sellerKey, []);
    }
    sellerMap.get(listing.sellerKey)!.push(assignment);
  }

  const sellers: SellerSummary[] = [];
  for (const [sellerKey, sellerAssignments] of sellerMap) {
    const firstListing = sellerAssignments[0].listing;
    const subtotal = sellerAssignments.reduce(
      (sum, a) => sum + a.listing.priceCents,
      0
    );
    sellers.push({
      sellerName: firstListing.sellerName,
      sellerKey,
      items: sellerAssignments,
      subtotalCents: subtotal,
      shippingCents: firstListing.shippingCents,
      totalCents: subtotal + firstListing.shippingCents,
    });
  }

  const totalCostCents = sellers.reduce((sum, s) => sum + s.totalCents, 0);
  const originalTotalCents = items.reduce(
    (sum, item) => sum + item.currentPriceCents,
    0
  );

  return {
    assignments,
    sellers,
    totalCostCents,
    originalTotalCents,
    savingsCents: originalTotalCents - totalCostCents,
    solveTimeMs,
    skippedCards: [],
  };
}

/**
 * Create the offscreen document if it doesn't exist, then send
 * the model to the solver running in it.
 */
let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    // Check if already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }
  } catch {
    // getContexts may not exist in older Chrome — just try creating
  }

  try {
    await chrome.offscreen.createDocument({
      url: "src/offscreen/offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Run HiGHS WASM solver which requires window/DOM APIs",
    });
    offscreenCreated = true;
    console.log("[TCG Optimizer SW] Offscreen document created");
  } catch (err) {
    // May already exist
    if (String(err).includes("single offscreen")) {
      offscreenCreated = true;
    } else {
      throw err;
    }
  }
}

async function solveViaOffscreen(input: ModelInput): Promise<SolverResult> {
  await ensureOffscreen();

  const rawResult: {
    status: string;
    objectiveValue: number;
    chosenListings: Array<[number, string]>;
    activeSellers: string[];
    solveTimeMs: number;
    errorMessage?: string;
  } = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "SOLVE", input }, resolve);
  });

  // Convert back from plain objects to Maps/Sets
  return {
    status: rawResult.status as SolverResult["status"],
    objectiveValue: rawResult.objectiveValue,
    chosenListings: new Map(rawResult.chosenListings),
    activeSellers: new Set(rawResult.activeSellers),
    solveTimeMs: rawResult.solveTimeMs,
    errorMessage: rawResult.errorMessage,
  };
}

async function sendProgress(stage: string, progress: number, detail?: string) {
  const msg: ExtensionMessage = {
    type: "OPTIMIZATION_PROGRESS",
    stage,
    progress,
    detail,
  };

  // Send to all TCGPlayer tabs (content scripts listen there)
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.tcgplayer.com/*" });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {
          // Content script may not be loaded on this tab
        });
      }
    }
  } catch {
    // Ignore errors querying tabs
  }

  // Also send via runtime for any popup listeners
  chrome.runtime.sendMessage(msg).catch(() => {
    // No popup listeners
  });
}
