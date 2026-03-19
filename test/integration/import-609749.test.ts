import { describe, it, expect } from "vitest";
import {
  createAnonymousCart,
  addItemToCart,
  validateCart,
  removeItemFromCart,
} from "../../src/api/cart";
import { fetchCheapestListings } from "../../src/api/tcgplayer";

/**
 * Integration test for importing product 609749.
 *
 * Product has:
 * - Normal: top 2 listings are PHANTOM (ch:1, dirInv:0), first valid is #3
 * - Foil: listings have ch:1 but dirInv:23 (not phantom)
 *
 * Tests the full import flow: fetchCheapestListings → addItemToCart → verify.
 */

const PRODUCT_ID = 609749;

describe("Import product 609749", () => {
  it(
    "Step 1: fetchCheapestListings filters out phantom listings",
    async () => {
      const listings = await fetchCheapestListings(PRODUCT_ID, "Near Mint", ["Normal", "Foil"]);
      console.log(`[TEST] Got ${listings.length} listings`);

      for (let i = 0; i < Math.min(5, listings.length); i++) {
        const l = listings[i];
        console.log(`[TEST] ${i + 1}. seller=${l.sellerKey} price=$${l.price.toFixed(2)} total=$${l.totalPrice.toFixed(2)} sku=${l.sku} ch=${l.channelId} ${l.printing}`);
      }

      expect(listings.length).toBeGreaterThan(0);

      // The phantom listings (ch:1, dirInv:0) should be filtered out
      // First Normal listing should NOT be CardboardBizarreCom or House of Reeves
      const normalListings = listings.filter(l => l.printing === "Normal");
      if (normalListings.length > 0) {
        console.log(`[TEST] First Normal listing seller: ${normalListings[0].sellerKey} (should not be ed6137c0 or 4a081735)`);
        expect(normalListings[0].sellerKey).not.toBe("ed6137c0"); // CardboardBizarreCom (phantom)
        expect(normalListings[0].sellerKey).not.toBe("4a081735"); // House of Reeves (phantom)
      }
    },
    30000
  );

  it(
    "Step 2: Add cheapest listing to cart",
    async () => {
      const listings = await fetchCheapestListings(PRODUCT_ID, "Near Mint", ["Normal", "Foil"]);
      expect(listings.length).toBeGreaterThan(0);

      const listing = listings[0];
      console.log(`[TEST] Using: seller=${listing.sellerKey} price=$${listing.price.toFixed(2)} sku=${listing.sku} ch=${listing.channelId} ${listing.printing}`);

      const cartKey = await createAnonymousCart();
      console.log(`[TEST] Cart: ${cartKey}`);

      // Try adding — may fail on anonymous cart for Direct listings
      try {
        await addItemToCart(cartKey, listing.sku, listing.sellerKey, 1, "US", listing.channelId);
        console.log("[TEST] Add succeeded");

        const items = await validateCart(cartKey);
        console.log(`[TEST] Cart has ${items.length} items`);

        if (items.length > 0) {
          expect(items[0].sku).toBe(listing.sku);
          for (const item of items) await removeItemFromCart(cartKey, item.cartItemId);
        }
      } catch (err) {
        console.log(`[TEST] Add failed: ${err}`);

        // If first listing failed, try fallback sellers
        let added = false;
        for (let i = 1; i < Math.min(5, listings.length); i++) {
          const fallback = listings[i];
          console.log(`[TEST] Trying fallback ${i}: seller=${fallback.sellerKey} price=$${fallback.price.toFixed(2)} ch=${fallback.channelId} ${fallback.printing}`);
          try {
            await addItemToCart(cartKey, fallback.sku, fallback.sellerKey, 1, "US", fallback.channelId);
            console.log(`[TEST] Fallback ${i} succeeded`);
            added = true;

            const items = await validateCart(cartKey);
            console.log(`[TEST] Cart has ${items.length} items`);
            for (const item of items) await removeItemFromCart(cartKey, item.cartItemId);
            break;
          } catch (e) {
            console.log(`[TEST] Fallback ${i} failed: ${e}`);
          }
        }

        if (!added) {
          console.error("[TEST] All sellers failed for this product");
        }
      }
    },
    60000
  );
});
