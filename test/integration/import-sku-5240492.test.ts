import { describe, it, expect } from "vitest";
import {
  createAnonymousCart,
  addItemToCart,
  validateCart,
  removeItemFromCart,
  getProductsForSkus,
} from "../../src/api/cart";
import { fetchCheapestListings } from "../../src/api/tcgplayer";

/**
 * Integration test for importing by SKU 5240492.
 *
 * Mirrors the handleImportSkus flow:
 *   1. Look up product details for the SKU (productId, condition, printing)
 *   2. Fetch cheapest listings matching that condition/printing
 *   3. Add to cart
 */

const TEST_SKU = 5240492;

/** Strip printing suffix from condition (e.g. "Near Mint Foil" → "Near Mint") */
function normalizeCondition(condition: string, printing: string): string {
  return condition.replace(new RegExp(`\\s+${printing}$`, "i"), "");
}

describe("Import by SKU 5240492", () => {
  it(
    "Step 1: getProductsForSkus returns product details",
    async () => {
      const products = await getProductsForSkus([TEST_SKU]);
      expect(products.length).toBe(1);

      const p = products[0];
      console.log(
        `[TEST] SKU ${TEST_SKU} → productId=${p.productId}, name="${p.productName}", condition="${p.condition}", printing="${p.printing}", set="${p.setName}"`
      );

      expect(p.sku).toBe(TEST_SKU);
      expect(p.productId).toBeGreaterThan(0);
      expect(p.condition).toBeTruthy();
      expect(p.printing).toBeTruthy();
    },
    30000
  );

  it(
    "Step 2: fetchCheapestListings returns listings for the SKU's product/condition/printing",
    async () => {
      const products = await getProductsForSkus([TEST_SKU]);
      const p = products[0];

      const condition = normalizeCondition(p.condition, p.printing);
      const listings = await fetchCheapestListings(
        p.productId,
        condition,
        [p.printing]
      );
      console.log(`[TEST] Got ${listings.length} listings for product ${p.productId} (${condition} / ${p.printing})`);

      for (let i = 0; i < Math.min(5, listings.length); i++) {
        const l = listings[i];
        console.log(
          `[TEST] ${i + 1}. seller=${l.sellerKey} price=$${l.price.toFixed(2)} total=$${l.totalPrice.toFixed(2)} sku=${l.sku} ch=${l.channelId} ${l.printing}`
        );
      }

      expect(listings.length).toBeGreaterThan(0);
    },
    30000
  );

  it(
    "Step 3: Full import-by-SKU flow — lookup, fetch listings, add to cart",
    async () => {
      // Step 1: Look up product for SKU
      const products = await getProductsForSkus([TEST_SKU]);
      expect(products.length).toBe(1);
      const p = products[0];

      // Step 2: Fetch cheapest listings
      const condition = normalizeCondition(p.condition, p.printing);
      const listings = await fetchCheapestListings(
        p.productId,
        condition,
        [p.printing]
      );
      expect(listings.length).toBeGreaterThan(0);

      // Step 3: Create cart and try adding
      const cartKey = await createAnonymousCart();
      console.log(`[TEST] Cart: ${cartKey}`);

      let added = false;
      for (let i = 0; i < Math.min(5, listings.length); i++) {
        const listing = listings[i];
        console.log(
          `[TEST] Trying listing ${i + 1}: seller=${listing.sellerKey} price=$${listing.price.toFixed(2)} sku=${listing.sku} ch=${listing.channelId} ${listing.printing}`
        );
        try {
          await addItemToCart(
            cartKey,
            listing.sku,
            listing.sellerKey,
            1,
            "US",
            listing.channelId
          );
          console.log(`[TEST] Add succeeded (listing ${i + 1})`);
          added = true;

          const items = await validateCart(cartKey);
          console.log(`[TEST] Cart has ${items.length} items`);

          if (items.length > 0) {
            expect(items[0].sku).toBe(listing.sku);
            for (const item of items) {
              await removeItemFromCart(cartKey, item.cartItemId);
            }
          }
          break;
        } catch (err) {
          console.log(`[TEST] Listing ${i + 1} failed: ${err}`);
        }
      }

      expect(added).toBe(true);
    },
    60000
  );
});
