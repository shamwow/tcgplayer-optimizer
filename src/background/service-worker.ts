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
import { fetchListings, fetchCheapestListings } from "@/api/tcgplayer";
import { getCartKey, fetchCartItems, getCartSummary, validateCart, removeItemFromCart, addItemToCart, createAnonymousCart, getProductsForSkus } from "@/api/cart";

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
      handleOptimize(message.items, message.verifiedOnly, message.mode, sendResponse);
      return true; // async
    }
    if (message.type === "UPDATE_CART") {
      handleUpdateCart(message.result, message.items, sendResponse);
      return true; // async
    }
    if (message.type === "IMPORT_PRODUCTS") {
      handleImportProducts(message.productIds, sendResponse);
      return true; // async
    }
    if (message.type === "IMPORT_SKUS") {
      handleImportSkus(message.skus, sendResponse);
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
  mode: "cheapest" | "fewest-packages" = "cheapest",
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
    const modelInput = buildModelInput(optimizableItems, allListings, mode);
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
            channelId: 0,
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

async function handleUpdateCart(
  result: OptimizationResult,
  originalItems: CartItem[],
  sendResponse: (msg: ExtensionMessage) => void
) {
  try {
    // Build SKU lookup from original cart items
    const skuByCartIndex = new Map<number, number>();
    const sellerKeyByCartIndex = new Map<number, string>();
    for (const item of originalItems) {
      skuByCartIndex.set(item.cartIndex, item.sku);
      sellerKeyByCartIndex.set(item.cartIndex, item.currentSellerKey);
    }

    // Step 1: Get cart key
    sendUpdateProgress("Getting cart...", 0);
    let cartKey = await getCartKeyFromCookie();
    if (!cartKey) cartKey = await getCartKey();
    if (!cartKey) {
      sendResponse({ type: "UPDATE_CART_RESULT", success: false, error: "Could not find cart key" });
      return;
    }

    // Step 2: Validate cart to get cartItemIds for removal
    sendUpdateProgress("Reading current cart...", 0.05);
    const currentItems = await validateCart(cartKey);
    console.log(`[TCG Optimizer SW] Cart has ${currentItems.length} items to remove`);

    // Step 3: Remove all items
    const totalSteps = currentItems.length + result.assignments.length;
    for (let i = 0; i < currentItems.length; i++) {
      sendUpdateProgress(`Removing items... (${i + 1}/${currentItems.length})`, 0.1 + (i / totalSteps) * 0.8);
      await removeItemFromCart(cartKey, currentItems[i].cartItemId);
    }
    console.log(`[TCG Optimizer SW] Removed all ${currentItems.length} items`);

    // Wait for TCGPlayer to release seller inventory after removal
    sendUpdateProgress("Waiting for inventory to update...", 0.5);
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Step 4: Add optimized items
    const assignments = result.assignments;
    for (let i = 0; i < assignments.length; i++) {
      sendUpdateProgress(`Adding items... (${i + 1}/${assignments.length})`, 0.1 + ((currentItems.length + i) / totalSteps) * 0.8);
      const a = assignments[i];
      const sku = skuByCartIndex.get(a.cartIndex);
      if (!sku) {
        console.warn(`[TCG Optimizer SW] No SKU for cartIndex ${a.cartIndex}, skipping`);
        continue;
      }

      // For skipped/kept items use original seller key, otherwise use optimized listing's seller key
      const sellerKey = a.listing.listingId === "current"
        ? sellerKeyByCartIndex.get(a.cartIndex) ?? a.listing.sellerKey
        : a.listing.sellerKey;

      const channelId = a.listing.listingId === "current" ? 0 : a.listing.channelId;
      try {
        await addItemToCart(cartKey, sku, sellerKey, 1, "US", channelId);
      } catch (err) {
        console.error(`[TCG Optimizer SW] Failed to add item ${i + 1}/${assignments.length}: "${a.name}" (sku=${sku}, seller=${sellerKey}, ch=${channelId})`, err);
        throw err;
      }
    }

    console.log(`[TCG Optimizer SW] Cart updated with ${assignments.length} items`);
    sendResponse({ type: "UPDATE_CART_RESULT", success: true });
  } catch (err) {
    console.error("[TCG Optimizer SW] handleUpdateCart error:", err);
    sendResponse({
      type: "UPDATE_CART_RESULT",
      success: false,
      error: err instanceof Error ? err.message : "Failed to update cart",
    });
  }
}

async function handleImportProducts(
  productIds: number[],
  sendResponse: (msg: ExtensionMessage) => void
) {
  try {
    console.log(`[TCG Optimizer SW] Importing ${productIds.length} products`);

    // Step 1: Get or create cart key
    sendImportProgress("Getting cart...", 0);
    let cartKey = await getCartKeyFromCookie();
    if (!cartKey) cartKey = await getCartKey();
    if (!cartKey) {
      cartKey = await createAnonymousCart();
    }
    if (!cartKey) {
      sendResponse({ type: "OPTIMIZATION_ERROR", error: "Could not find or create cart" });
      return;
    }

    // Step 2: For each product, fetch cheapest listings and try adding to cart
    let added = 0;
    const failed: { productId: number; reason: string }[] = [];
    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i];
      sendImportProgress(`Adding product ${i + 1}/${productIds.length}...`, (i / productIds.length) * 0.8);

      const listings = await fetchCheapestListings(productId, "Near Mint", ["Normal", "Foil"]);
      if (listings.length === 0) {
        console.warn(`[TCG Optimizer SW] [${i + 1}/${productIds.length}] Product ${productId}: no verified listings found`);
        failed.push({ productId, reason: "No verified listing found" });
        continue;
      }

      console.log(`[TCG Optimizer SW] [${i + 1}/${productIds.length}] Product ${productId}: found ${listings.length} verified listings (cheapest: $${listings[0].price.toFixed(2)} ${listings[0].printing})`);

      let addedThis = false;
      let lastErr = "";
      for (let s = 0; s < listings.length; s++) {
        const listing = listings[s];
        console.log(`[TCG Optimizer SW] [${i + 1}/${productIds.length}] Product ${productId}: trying seller ${s + 1}/${listings.length} — SKU=${listing.sku}, seller=${listing.sellerKey}, price=$${listing.price.toFixed(2)}, ${listing.printing}`);
        try {
          await addItemToCart(cartKey, listing.sku, listing.sellerKey, 1, "US", listing.channelId);
          added++;
          addedThis = true;
          console.log(`[TCG Optimizer SW] [${i + 1}/${productIds.length}] Product ${productId}: added to cart OK (seller ${s + 1}, ${listing.printing})`);
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          console.warn(`[TCG Optimizer SW] [${i + 1}/${productIds.length}] Product ${productId} (${listing.printing}): seller ${listing.sellerKey} failed — ${lastErr}`);
        }
      }

      if (!addedThis) {
        const tried = listings.map(l => l.sellerKey).join(", ");
        console.error(`[TCG Optimizer SW] [${i + 1}/${productIds.length}] Product ${productId}: FAILED all ${listings.length} sellers (${tried}) — ${lastErr}`);
        failed.push({ productId, reason: `Product ${productId}: all ${listings.length} sellers unavailable — ${lastErr}` });
      }
    }

    console.log(`[TCG Optimizer SW] Import batch done: ${added} added, ${failed.length} failed out of ${productIds.length}`);
    if (failed.length > 0) {
      console.warn(`[TCG Optimizer SW] Failed products:`, failed);
    }

    if (added === 0) {
      sendResponse({
        type: "OPTIMIZATION_ERROR",
        error: `Could not add any of the ${productIds.length} products to cart. Failures: ${failed.map(f => `${f.productId} (${f.reason})`).join(", ")}`,
      });
      return;
    }

    // Step 3: Read the cart back
    sendImportProgress("Reading cart...", 0.9);
    const [items, rawSummary] = await Promise.all([
      fetchCartItems(cartKey),
      getCartSummary(cartKey).catch(() => null),
    ]);

    let summary: CartSummary | null = null;
    if (rawSummary) {
      summary = {
        itemCount: rawSummary.itemCount,
        sellerCount: rawSummary.fulfillerCount,
        cartCostCents: Math.round(rawSummary.requestedTotalCost * 100),
        shippingCostCents: Math.round(rawSummary.estimatedShippingCost * 100),
      };
    }

    const failMsg = failed.length > 0
      ? `(${failed.length} product${failed.length > 1 ? "s" : ""} could not be added: ${failed.map(f => f.productId).join(", ")})`
      : "";
    console.log(`[TCG Optimizer SW] Import complete: ${added} added, ${failed.length} failed. Cart has ${items.length} items. ${failMsg}`);

    sendResponse({ type: "CART_DATA", items, summary });
  } catch (err) {
    console.error("[TCG Optimizer SW] handleImportProducts error:", err);
    sendResponse({
      type: "OPTIMIZATION_ERROR",
      error: err instanceof Error ? err.message : "Failed to import products",
    });
  }
}

async function handleImportSkus(
  skus: number[],
  sendResponse: (msg: ExtensionMessage) => void
) {
  try {
    console.log(`[TCG Optimizer SW] Importing ${skus.length} SKUs`);

    // Step 1: Get or create cart key
    sendImportProgress("Getting cart...", 0);
    let cartKey = await getCartKeyFromCookie();
    if (!cartKey) cartKey = await getCartKey();
    if (!cartKey) {
      cartKey = await createAnonymousCart();
    }
    if (!cartKey) {
      sendResponse({ type: "OPTIMIZATION_ERROR", error: "Could not find or create cart" });
      return;
    }

    // Step 2: Look up product details for all SKUs
    sendImportProgress("Looking up products...", 0.05);
    const products = await getProductsForSkus(skus);
    const productBySku = new Map<number, { productId: number; condition: string; printing: string }>();
    for (const p of products) {
      // The SKU API returns condition with printing appended (e.g. "Near Mint Foil").
      // Strip the printing suffix so the listings API gets just "Near Mint".
      const condition = p.condition.replace(new RegExp(`\\s+${p.printing}$`, "i"), "");
      productBySku.set(p.sku, { productId: p.productId, condition, printing: p.printing });
    }

    // Step 3: For each SKU, fetch cheapest listings matching its condition/printing and add to cart
    let added = 0;
    const failed: { sku: number; reason: string }[] = [];
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      sendImportProgress(`Adding item ${i + 1}/${skus.length}...`, (i / skus.length) * 0.8 + 0.1);

      const product = productBySku.get(sku);
      if (!product) {
        console.warn(`[TCG Optimizer SW] [${i + 1}/${skus.length}] SKU ${sku}: no product found`);
        failed.push({ sku, reason: "Product not found for SKU" });
        continue;
      }

      const listings = await fetchCheapestListings(product.productId, product.condition, [product.printing]);
      if (listings.length === 0) {
        console.warn(`[TCG Optimizer SW] [${i + 1}/${skus.length}] SKU ${sku}: no verified listings found`);
        failed.push({ sku, reason: "No verified listing found" });
        continue;
      }

      console.log(`[TCG Optimizer SW] [${i + 1}/${skus.length}] SKU ${sku} (product ${product.productId}): found ${listings.length} listings (cheapest: $${listings[0].price.toFixed(2)} ${listings[0].printing})`);

      let addedThis = false;
      let lastErr = "";
      for (let s = 0; s < listings.length; s++) {
        const listing = listings[s];
        try {
          await addItemToCart(cartKey, listing.sku, listing.sellerKey, 1, "US", listing.channelId);
          added++;
          addedThis = true;
          console.log(`[TCG Optimizer SW] [${i + 1}/${skus.length}] SKU ${sku}: added to cart OK (seller ${s + 1}, ${listing.printing})`);
          break;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          console.warn(`[TCG Optimizer SW] [${i + 1}/${skus.length}] SKU ${sku}: seller ${listing.sellerKey} failed — ${lastErr}`);
        }
      }

      if (!addedThis) {
        failed.push({ sku, reason: `All ${listings.length} sellers unavailable — ${lastErr}` });
      }
    }

    console.log(`[TCG Optimizer SW] SKU import done: ${added} added, ${failed.length} failed out of ${skus.length}`);

    if (added === 0) {
      sendResponse({
        type: "OPTIMIZATION_ERROR",
        error: `Could not add any of the ${skus.length} SKUs to cart. Failures: ${failed.map(f => `${f.sku} (${f.reason})`).join(", ")}`,
      });
      return;
    }

    // Step 4: Read the cart back
    sendImportProgress("Reading cart...", 0.9);
    const [items, rawSummary] = await Promise.all([
      fetchCartItems(cartKey),
      getCartSummary(cartKey).catch(() => null),
    ]);

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
    console.error("[TCG Optimizer SW] handleImportSkus error:", err);
    sendResponse({
      type: "OPTIMIZATION_ERROR",
      error: err instanceof Error ? err.message : "Failed to import SKUs",
    });
  }
}

async function sendImportProgress(stage: string, progress: number) {
  const msg: ExtensionMessage = { type: "IMPORT_PRODUCTS_PROGRESS", stage, progress };
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.tcgplayer.com/*" });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  } catch {}
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function sendUpdateProgress(stage: string, progress: number) {
  const msg: ExtensionMessage = { type: "UPDATE_CART_PROGRESS", stage, progress };
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.tcgplayer.com/*" });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  } catch {}
  chrome.runtime.sendMessage(msg).catch(() => {});
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
  allListings: Map<number, SellerListing[]>,
  mode: "cheapest" | "fewest-packages" = "cheapest"
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
    mode,
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
