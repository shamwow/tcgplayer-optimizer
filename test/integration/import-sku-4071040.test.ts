import { describe, it, expect } from "vitest";
import {
  createAnonymousCart,
  addItemToCart,
  validateCart,
  removeItemFromCart,
  getProductsForSkus,
} from "../../src/api/cart";

/**
 * Debug integration test for SKU 4071040, seller 41de3db8, price $0.05
 * which fails with CartItemQuantityNotAvailable.
 *
 * This test checks:
 * 1. What product this SKU maps to
 * 2. Whether the raw API response gives us more detail
 * 3. Whether a different price or seller works
 */

const TEST_SKU = 4071040;
const TEST_SELLER_KEY = "41de3db8";
const COUNTRY_CODE = "US";

describe("Debug import for SKU 4071040", () => {
  it(
    "Step 1: Look up product info for this SKU",
    async () => {
      const products = await getProductsForSkus([TEST_SKU]);
      console.log("[DEBUG] Product info for SKU 4071040:", products);

      if (products.length > 0) {
        const p = products[0];
        console.log(`[DEBUG] Product: ${p.productName} (ID: ${p.productId})`);
        console.log(`[DEBUG] Set: ${p.setName}, Condition: ${p.condition}, Printing: ${p.printing}`);
      } else {
        console.error("[DEBUG] No product found for this SKU");
      }
    },
    15000
  );

  it(
    "Step 2: Try adding with original params (expect failure)",
    async () => {
      const cartKey = await createAnonymousCart();
      console.log(`[DEBUG] Cart key: ${cartKey}`);

      try {
        await addItemToCart(cartKey, TEST_SKU, TEST_SELLER_KEY, 1, COUNTRY_CODE);
        console.log("[DEBUG] Unexpectedly succeeded!");

        const items = await validateCart(cartKey, COUNTRY_CODE);
        console.log("[DEBUG] Cart items:", items);

        // Clean up
        for (const item of items) {
          await removeItemFromCart(cartKey, item.cartItemId);
        }
      } catch (err) {
        console.log(`[DEBUG] Failed as expected: ${err}`);
      }
    },
    30000
  );

  it(
    "Step 3: Fetch raw listing to check actual availability",
    async () => {
      // Look up the product ID first
      const products = await getProductsForSkus([TEST_SKU]);
      if (products.length === 0) {
        console.error("[DEBUG] Can't look up listings — unknown product for SKU");
        return;
      }
      const productId = products[0].productId;
      const condition = products[0].condition;
      const printing = products[0].printing;

      console.log(`[DEBUG] Looking up listings for product ${productId} (${condition} / ${printing})`);

      const response = await fetch(
        `https://mp-search-api.tcgplayer.com/v1/product/${productId}/listings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0",
            Origin: "https://www.tcgplayer.com",
            Referer: "https://www.tcgplayer.com/",
          },
          body: JSON.stringify({
            filters: {
              term: {
                condition: [condition],
                printing: [printing],
                sellerStatus: ["Live"],
                language: ["English"],
              },
              range: {},
              exclude: {},
            },
            from: 0,
            size: 10,
            sort: { field: "price+shipping", order: "asc" },
            context: { shippingCountry: COUNTRY_CODE, cart: {} },
          }),
        }
      );

      const data = await response.json();
      const results = data.results?.[0]?.results ?? [];
      console.log(`[DEBUG] Total results: ${data.results?.[0]?.totalResults}, returned: ${results.length}`);

      // Find the specific seller
      const sellerListing = results.find(
        (r: { sellerKey: string }) => r.sellerKey === TEST_SELLER_KEY
      );
      if (sellerListing) {
        console.log(`[DEBUG] Seller ${TEST_SELLER_KEY} listing:`, {
          listingId: sellerListing.listingId,
          price: sellerListing.price,
          quantity: sellerListing.quantity,
          condition: sellerListing.condition,
          printing: sellerListing.printing,
          language: sellerListing.language,
          goldSeller: sellerListing.goldSeller,
          productConditionId: sellerListing.productConditionId,
        });
      } else {
        console.log(`[DEBUG] Seller ${TEST_SELLER_KEY} NOT found in top 10 listings`);
      }

      // Show first 3 listings
      for (let i = 0; i < Math.min(3, results.length); i++) {
        const l = results[i];
        console.log(`[DEBUG] Listing ${i}:`, {
          sellerKey: l.sellerKey,
          sellerName: l.sellerName,
          price: l.price,
          quantity: l.quantity,
          language: l.language,
          goldSeller: l.goldSeller,
          productConditionId: l.productConditionId,
        });
      }

      // Try adding the first listing with quantity > 0 and goldSeller
      const viable = results.find(
        (r: { goldSeller: boolean; quantity: number; productConditionId: number }) =>
          r.goldSeller && r.quantity > 0 && r.productConditionId
      );
      if (viable) {
        console.log(`[DEBUG] Trying viable listing: seller=${viable.sellerKey}, price=${viable.price}, sku=${viable.productConditionId}, qty=${viable.quantity}`);
        const cartKey = await createAnonymousCart();
        try {
          await addItemToCart(cartKey, viable.productConditionId, viable.sellerKey, 1, COUNTRY_CODE);
          console.log("[DEBUG] Successfully added viable listing!");
          const items = await validateCart(cartKey, COUNTRY_CODE);
          console.log("[DEBUG] Cart after viable add:", items.length, "items");
          for (const item of items) {
            await removeItemFromCart(cartKey, item.cartItemId);
          }
        } catch (err) {
          console.error(`[DEBUG] Viable listing also failed: ${err}`);
        }
      }
    },
    30000
  );
});
