import { describe, it, expect } from "vitest";
import {
  getCartKey,
  createAnonymousCart,
  addItemToCart,
  removeItemFromCart,
  getCartSummary,
  validateCart,
  getProductsForSkus,
  fetchCartItems,
} from "../../src/api/cart";

/**
 * Live verification tests for the TCGPlayer cart API.
 *
 * These tests exercise the full cart lifecycle against the real API:
 * 1. Create anonymous cart
 * 2. Add an item
 * 3. Read cart summary
 * 4. Validate cart (get full item details)
 * 5. Look up product details from SKU
 * 6. Read cart as CartItem[] (the full pipeline)
 *
 * Uses a known SKU (7481818 = product 521498, Near Mint, Normal)
 * and a known seller (from live listings).
 */

const TEST_PRODUCT_ID = 521498;
const TEST_SKU = 7481818; // Near Mint, Normal for product 521498
const COUNTRY_CODE = "US";

/** Fetch a real sellerKey and price from live listings for our test product */
async function getTestListing(): Promise<{
  sellerKey: string;
  price: number;
  sku: number;
}> {
  const response = await fetch(
    `https://mp-search-api.tcgplayer.com/v1/product/${TEST_PRODUCT_ID}/listings`,
    {
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
            condition: ["Near Mint"],
            printing: ["Normal"],
            sellerStatus: ["Live"],
          },
          range: {},
          exclude: {},
        },
        from: 0,
        size: 1,
        sort: { field: "price+shipping", order: "asc" },
        context: { shippingCountry: COUNTRY_CODE, cart: {} },
      }),
    }
  );

  const data = await response.json();
  const listing = data.results[0].results[0];
  return {
    sellerKey: listing.sellerKey,
    price: listing.price,
    sku: TEST_SKU,
  };
}

describe("TCGPlayer Cart API - Full Lifecycle", () => {
  it(
    "returns null cartKey for unauthenticated user",
    async () => {
      const cartKey = await getCartKey();
      expect(cartKey).toBeNull();
    },
    15000
  );

  it(
    "creates an anonymous cart",
    async () => {
      const cartKey = await createAnonymousCart();
      expect(cartKey).toBeTruthy();
      expect(typeof cartKey).toBe("string");
      expect(cartKey.length).toBeGreaterThan(10);
    },
    15000
  );

  it(
    "full cart lifecycle: create → add → read → validate → fetchCartItems",
    async () => {
      // Step 1: Create anonymous cart
      const cartKey = await createAnonymousCart();
      expect(cartKey).toBeTruthy();

      // Step 2: Get a real listing to add
      const listing = await getTestListing();
      expect(listing.sellerKey).toBeTruthy();
      expect(listing.price).toBeGreaterThan(0);

      // Step 3: Add item to cart
      await addItemToCart(
        cartKey,
        listing.sku,
        listing.sellerKey,
        1,
        COUNTRY_CODE
      );

      // Step 4: Read cart summary
      const summary = await getCartSummary(cartKey);
      expect(summary.cartKey).toBe(cartKey);
      expect(summary.itemCount).toBe(1);
      expect(summary.sellers.length).toBe(1);
      expect(summary.sellers[0].sellerKey).toBe(listing.sellerKey);
      expect(summary.sellers[0].productTotalCost).toBeGreaterThan(0);
      expect(summary.sellers[0].shippingCost).toBeGreaterThanOrEqual(0);

      // Step 5: Validate cart (get full item details)
      const validated = await validateCart(cartKey, COUNTRY_CODE);
      expect(validated.length).toBe(1);
      expect(validated[0].sku).toBe(listing.sku);
      expect(validated[0].quantity).toBe(1);
      expect(validated[0].sellerKey).toBe(listing.sellerKey);
      expect(validated[0].currentPrice).toBeGreaterThan(0);

      // Step 6: Look up product info from SKU
      const products = await getProductsForSkus([listing.sku]);
      expect(products.length).toBeGreaterThan(0);
      const product = products[0];
      expect(product.productId).toBe(TEST_PRODUCT_ID);
      expect(product.productName).toBeTruthy();
      expect(product.condition).toBe("Near Mint");
      expect(product.printing).toBe("Normal");
      expect(product.setName).toBeTruthy();

      // Step 7: Full pipeline - fetchCartItems
      const cartItems = await fetchCartItems(cartKey);
      expect(cartItems.length).toBe(1);
      expect(cartItems[0].productId).toBe(TEST_PRODUCT_ID);
      expect(cartItems[0].name).toBeTruthy();
      expect(cartItems[0].condition).toBe("Near Mint");
      expect(cartItems[0].printing).toBe("Normal");
      expect(cartItems[0].quantity).toBe(1);
      expect(cartItems[0].currentPriceCents).toBeGreaterThan(0);

      // Step 8: Remove item from cart
      const cartItemId = validated[0].cartItemId;
      await removeItemFromCart(cartKey, cartItemId);

      // Step 9: Verify cart is empty after removal
      const summaryAfter = await getCartSummary(cartKey);
      expect(summaryAfter.itemCount).toBe(0);
    },
    30000
  );

  it(
    "handles empty cart correctly",
    async () => {
      const cartKey = await createAnonymousCart();

      const summary = await getCartSummary(cartKey);
      expect(summary.itemCount).toBe(0);
      expect(summary.sellers.length).toBe(0);

      const items = await fetchCartItems(cartKey);
      expect(items).toEqual([]);
    },
    15000
  );
});
