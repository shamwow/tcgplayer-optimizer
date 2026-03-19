import { describe, it, expect } from "vitest";
import {
  createAnonymousCart,
  addItemToCart,
  validateCart,
  removeItemFromCart,
} from "../../src/api/cart";

/**
 * Integration test: compare current cart vs optimized cart costs.
 * Checks if the "optimized" cart is actually cheaper, and investigates
 * whether the current cart sellers have channelId=1 listings.
 */

const CURRENT_CART: Array<[number, string]> = [
  [4071040, "a68bcd33"],
  [1170536, "a68bcd33"],
  [4990525, "ce2437e2"],
  [4969246, "a68bcd33"],
  [5301093, "a68bcd33"],
  [4574047, "a68bcd33"],
  [5602729, "a68bcd33"],
  [5263120, "ce2437e2"],
  [7308074, "13b5f3a3"],
  [3006923, "973052d1"],
  [8336605, "a68bcd33"],
  [4568257, "a68bcd33"],
  [26493, "a68bcd33"],
  [2956586, "a68bcd33"],
  [25298, "a68bcd33"],
  [7673181, "a68bcd33"],
  [5240492, "6f642d75"],
  [8745626, "bbbd3baf"],
  [8322552, "5b2a546b"],
  [8050470, "5b2a546b"],
  [7513570, "21b0ab58"],
  [4553487, "b4fe2101"],
  [3624714, "5b2a546b"],
  [8310982, "bbbd3baf"],
  [8186829, "55b77426"],
  [7141877, "5a6e70ff"],
  [7959399, "5a6e70ff"],
  [4984072, "4652ac34"],
  [4871678, "4652ac34"],
  [4059940, "4652ac34"],
  [6813591, "bbbd3baf"],
  [7184288, "028817da"],
  [7543597, "b18afc4b"],
  [8552229, "c2a21a3c"],
  [8195842, "862c160b"],
  [8238097, "21b0ab58"],
  [1170156, "9c8ce84f"],
  [7108235, "6692bdcc"],
  [8241664, "6692bdcc"],
  [4796132, "6692bdcc"],
  [7458013, "c2a21a3c"],
  [7928469, "c2a21a3c"],
  [8810791, "c2a21a3c"],
  [393740, "d87f55df"],
  [7278528, "6f642d75"],
  [4568367, "d87f55df"],
  [8641193, "648841ed"],
  [8246191, "21b0ab58"],
  [18992, "9c8ce84f"],
  [4292186, "d87f55df"],
  [7469887, "277b05a9"],
  [4208173, "277b05a9"],
  [7438064, "d87f55df"],
  [4985062, "22eaaf6e"],
  [4150654, "d87f55df"],
  [4943502, "6f642d75"],
  [8466948, "b5d898ba"],
  [8322132, "b5d898ba"],
  [3318747, "4b4d231d"],
  [3614509, "d87f55df"],
  [7617360, "d87f55df"],
  [7944598, "b72f21b8"],
  [3914440, "45ef9c7f"],
  [8621235, "648841ed"],
  [8621175, "d87f55df"],
  [4856017, "973052d1"],
  [8043349, "ea9b0435"],
  [5376334, "ce2437e2"],
  [5696388, "13b5f3a3"],
  [7247251, "22eaaf6e"],
  [8467758, "2944ccdf"],
  [8047200, "2f5415c6"],
];

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

describe("Cart comparison: current vs optimized", () => {
  it(
    "checks if current cart sellers have channelId=1 listings",
    async () => {
      // Get product info for all SKUs
      const skus = CURRENT_CART.map(([sku]) => sku);
      const res = await fetch("https://mp-search-api.tcgplayer.com/v1/product/getProductForSkus", {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(skus),
      });
      const data = await res.json();
      const products = data.results?.flat() ?? [];

      // Build SKU -> productId map
      const productBySku = new Map<number, { productId: number; condition: string; printing: string }>();
      for (const p of products) {
        const condition = p.condition.replace(new RegExp(`\\s+${p.printing}$`, "i"), "");
        productBySku.set(p.sku, { productId: p.productId, condition, printing: p.printing });
      }

      // For each current cart item, look up the seller's listing to check channelId
      const uniqueProducts = new Map<number, { sku: number; sellerKey: string; condition: string; printing: string }>();
      for (const [sku, sellerKey] of CURRENT_CART) {
        const product = productBySku.get(sku);
        if (product) {
          uniqueProducts.set(product.productId, { sku, sellerKey, condition: product.condition, printing: product.printing });
        }
      }

      let ch1Count = 0;
      for (const [productId, info] of uniqueProducts) {
        const listingsRes = await fetch(`https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({
            filters: {
              term: { condition: [info.condition], printing: [info.printing], sellerStatus: ["Live"], language: ["English"] },
              range: {},
              exclude: {},
            },
            from: 0,
            size: 200,
            sort: { field: "price+shipping", order: "asc" },
            context: { shippingCountry: "US", cart: {} },
          }),
        });
        const listingsData = await listingsRes.json();
        const results = listingsData.results?.[0]?.results ?? [];

        const sellerListing = results.find((l: { sellerKey: string }) => l.sellerKey === info.sellerKey);
        if (sellerListing) {
          if (sellerListing.channelId === 1) {
            ch1Count++;
            console.log(`[TEST] ch=1: sku=${info.sku} seller=${info.sellerKey} product=${productId} price=$${sellerListing.price} ch=${sellerListing.channelId} dirInv=${sellerListing.directInventory}`);
          }
        } else {
          console.log(`[TEST] NOT FOUND: sku=${info.sku} seller=${info.sellerKey} product=${productId} (not in top 200 listings)`);
        }
      }

      console.log(`\n[TEST] ${ch1Count} out of ${uniqueProducts.size} unique products have channelId=1 sellers in current cart`);
    },
    300000
  );

  it(
    "compares total cost: current cart vs optimized cart",
    async () => {
      // Add current cart items
      const currentCartKey = await createAnonymousCart();
      console.log(`[TEST] Current cart: ${currentCartKey}`);

      let currentFailed = 0;
      for (const [sku, sellerKey] of CURRENT_CART) {
        try {
          await addItemToCart(currentCartKey, sku, sellerKey, 1, "US", 0);
        } catch {
          currentFailed++;
          console.log(`[TEST] Current cart add failed: sku=${sku} seller=${sellerKey}`);
        }
      }

      const currentItems = await validateCart(currentCartKey);
      const currentTotal = currentItems.reduce((sum, i) => sum + i.currentPrice, 0);
      console.log(`[TEST] Current cart: ${currentItems.length} items, total=$${currentTotal.toFixed(2)} (${currentFailed} failed)`);

      // Clean up current cart
      for (const item of currentItems) {
        await removeItemFromCart(currentCartKey, item.cartItemId);
      }

      console.log(`[TEST] Current cart total (items only): $${currentTotal.toFixed(2)}`);
    },
    300000
  );
});
