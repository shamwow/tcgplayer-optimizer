import { describe, it, expect } from "vitest";
import {
  createAnonymousCart,
  addItemToCart,
  validateCart,
  removeItemFromCart,
} from "../../src/api/cart";
import { fetchCheapestListing, fetchListings } from "../../src/api/tcgplayer";

/**
 * Debug integration test for product 559643 which fails to import.
 *
 * This test replicates the exact import flow:
 * 1. Fetch listings to examine what's available
 * 2. Use fetchCheapestListing (same as import handler)
 * 3. Add to cart
 * 4. Verify item is present
 */

const PRODUCT_ID = 559643;
const CONDITION = "Near Mint";
const PRINTING = "Normal";
const COUNTRY_CODE = "US";

describe("Debug import for product 559643", () => {
  it(
    "Step 1: Fetch raw listings and inspect response",
    async () => {
      const url = `https://mp-search-api.tcgplayer.com/v1/product/${PRODUCT_ID}/listings`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Origin: "https://www.tcgplayer.com",
          Referer: "https://www.tcgplayer.com/",
        },
        body: JSON.stringify({
          filters: {
            term: {
              condition: [CONDITION],
              printing: [PRINTING],
              sellerStatus: ["Live"],
            },
            range: {},
            exclude: {},
          },
          from: 0,
          size: 10,
          sort: { field: "price+shipping", order: "asc" },
          context: { shippingCountry: COUNTRY_CODE, cart: {} },
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      const resultSet = data.results?.[0];

      console.log(`[DEBUG] Total results: ${resultSet?.totalResults}`);
      console.log(`[DEBUG] Results returned: ${resultSet?.results?.length}`);

      // Log first 5 listings with all fields relevant to import
      const listings = resultSet?.results ?? [];
      for (let i = 0; i < Math.min(5, listings.length); i++) {
        const l = listings[i];
        console.log(`[DEBUG] Listing ${i}:`, {
          listingId: l.listingId,
          productId: l.productId,
          productConditionId: l.productConditionId,
          sellerKey: l.sellerKey,
          sellerName: l.sellerName,
          price: l.price,
          quantity: l.quantity,
          condition: l.condition,
          printing: l.printing,
          goldSeller: l.goldSeller,
          shippingPrice: l.shippingPrice,
        });
      }

      // Check if any listing has productConditionId
      const withSku = listings.filter(
        (l: { productConditionId: number }) => l.productConditionId
      );
      console.log(
        `[DEBUG] Listings with productConditionId: ${withSku.length}/${listings.length}`
      );

      // Check if any gold seller listing has productConditionId
      const goldWithSku = listings.filter(
        (l: { goldSeller: boolean; productConditionId: number }) =>
          l.goldSeller && l.productConditionId
      );
      console.log(
        `[DEBUG] Gold seller listings with productConditionId: ${goldWithSku.length}/${listings.length}`
      );

      expect(resultSet?.totalResults).toBeGreaterThan(0);
    },
    30000
  );

  it(
    "Step 2: fetchCheapestListing (same as import flow)",
    async () => {
      const result = await fetchCheapestListing(PRODUCT_ID, CONDITION, PRINTING);
      console.log(`[DEBUG] fetchCheapestListing result:`, result);

      if (!result) {
        console.error(
          `[DEBUG] fetchCheapestListing returned null — no gold seller listing with productConditionId found`
        );
      } else {
        console.log(
          `[DEBUG] SKU=${result.sku}, sellerKey=${result.sellerKey}, price=$${result.price}`
        );
      }

      expect(result).not.toBeNull();
    },
    30000
  );

  it(
    "Step 3: Full add-to-cart cycle",
    async () => {
      // Get listing
      const listing = await fetchCheapestListing(PRODUCT_ID, CONDITION, PRINTING);
      expect(listing).not.toBeNull();
      console.log(`[DEBUG] Using listing:`, listing);

      // Create cart
      const cartKey = await createAnonymousCart();
      expect(cartKey).toBeTruthy();
      console.log(`[DEBUG] Cart key: ${cartKey}`);

      // Add to cart
      await addItemToCart(
        cartKey,
        listing!.sku,
        listing!.sellerKey,
        1,
        COUNTRY_CODE
      );

      // Verify
      const cartItems = await validateCart(cartKey, COUNTRY_CODE);
      console.log(`[DEBUG] Cart items after add:`, cartItems);

      const found = cartItems.some((item) => item.sku === listing!.sku);
      console.log(`[DEBUG] Item found in cart: ${found}`);

      expect(found).toBe(true);

      // Clean up
      if (cartItems.length > 0) {
        for (const item of cartItems) {
          await removeItemFromCart(cartKey, item.cartItemId);
        }
      }
    },
    30000
  );

  it(
    "Step 4: fetchListings (used by optimizer) to check if listings exist",
    async () => {
      const listings = await fetchListings(PRODUCT_ID, CONDITION, PRINTING);
      console.log(
        `[DEBUG] fetchListings returned ${listings.length} listings`
      );
      if (listings.length > 0) {
        console.log(`[DEBUG] First listing:`, listings[0]);
      } else {
        console.error(
          `[DEBUG] No listings returned by fetchListings — this card would be skipped by the optimizer too`
        );
      }
    },
    30000
  );
});
