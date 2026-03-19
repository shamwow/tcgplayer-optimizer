import { describe, it, expect } from "vitest";
import {
  createAnonymousCart,
  addItemToCart,
  validateCart,
  removeItemFromCart,
} from "../../src/api/cart";

/**
 * Verification test: bulk add 72 items to cart.
 * Mirrors the handleUpdateCart flow after optimization.
 * Each entry is: sku, sellerKey, channelId
 */

const ITEMS: Array<[number, string, number]> = [
  [4071040, "104f3a96", 0],
  [1170536, "1fb64c9f", 0],
  [4990525, "e5546cf4", 0],
  [4969246, "e40a1a2f", 0],
  [5301093, "ef14af73", 0],
  [4574047, "0db697fc", 0],
  [5602729, "ef14af73", 0],
  [4871678, "1fb64c9f", 0],
  [5263120, "9d6bf903", 0],
  [7308074, "4290cf0e", 0],
  [3006923, "9dbf0d26", 0],
  [8336605, "9d6bf903", 0],
  [4568257, "9dbf0d26", 0],
  [26493, "d87f55df", 0],
  [7141877, "104f3a96", 0],
  [2956586, "b9dd2656", 0],
  [25298, "55bbe338", 0],
  [8745626, "0db697fc", 0],
  [8322552, "5a19192c", 0],
  [7513570, "12f7cf8a", 0],
  [7543597, "12f7cf8a", 0],
  [8050470, "ac317b4c", 0],
  [4553487, "0db697fc", 0],
  [3624714, "72dfe122", 0],
  [8310982, "5a59564b", 0],
  [8186829, "12f7cf8a", 0],
  [4984072, "25d4ed7e", 0],
  [4059940, "19593628", 0],
  [6813591, "12f7cf8a", 0],
  [7959399, "0db697fc", 0],
  [7184288, "fb30da53", 0],
  [8552229, "12f7cf8a", 0],
  [1170156, "8a212e83", 0],
  [8195842, "0db697fc", 0],
  [8238097, "0ea5c518", 0],
  [8466948, "8479650c", 0],
  [393740, "0ea5c518", 0],
  [4150654, "d87f55df", 0],
  [7469887, "0db697fc", 0],
  [7108235, "fb30da53", 0],
  [8241664, "5a19192c", 0],
  [4796132, "c34f91d9", 0],
  [7458013, "0db697fc", 0],
  [7278528, "e5546cf4", 0],
  [4568367, "8135e755", 0],
  [7928469, "5a59564b", 0],
  [8641193, "d87f55df", 0],
  [8246191, "22eaaf6e", 0],
  [8810791, "0db697fc", 0],
  [18992, "5a19192c", 0],
  [4292186, "e5546cf4", 0],
  [4985062, "22eaaf6e", 0],
  [4943502, "8479650c", 0],
  [3318747, "8479650c", 0],
  [3614509, "d87f55df", 0],
  [4208173, "8479650c", 0],
  [7944598, "a0d3bff3", 0],
  [3914440, "8a212e83", 0],
  [7617360, "c34f91d9", 0],
  [8621235, "d87f55df", 0],
  [8322132, "12e62873", 0],
  [8621175, "d87f55df", 0],
  [8043349, "12e62873", 0],
  [5696388, "d87f55df", 0],
  [7247251, "22eaaf6e", 0],
  [8467758, "2944ccdf", 0],
  [8047200, "12e62873", 0],
  [7673181, "5b2e62e2", 0],
  [5240492, "6f642d75", 0],
  [7438064, "84168ed3", 0],
  [4856017, "973052d1", 0],
  [5376334, "4125eb21", 0],
];

describe("Bulk cart update (72 items)", () => {
  it(
    "adds all items to cart and reports failures",
    async () => {
      const cartKey = await createAnonymousCart();
      console.log(`[TEST] Cart: ${cartKey}`);

      const succeeded: number[] = [];
      const failed: Array<{ sku: number; sellerKey: string; error: string }> = [];

      for (let i = 0; i < ITEMS.length; i++) {
        const [sku, sellerKey, channelId] = ITEMS[i];
        try {
          await addItemToCart(cartKey, sku, sellerKey, 1, "US", channelId);
          succeeded.push(sku);
          console.log(`[TEST] ${i + 1}/${ITEMS.length} OK: sku=${sku} seller=${sellerKey}`);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          failed.push({ sku, sellerKey, error });
          console.error(`[TEST] ${i + 1}/${ITEMS.length} FAIL: sku=${sku} seller=${sellerKey} — ${error}`);
        }
      }

      console.log(`\n[TEST] Results: ${succeeded.length} succeeded, ${failed.length} failed out of ${ITEMS.length}`);
      if (failed.length > 0) {
        console.log("[TEST] Failed items:");
        for (const f of failed) {
          console.log(`  sku=${f.sku} seller=${f.sellerKey} — ${f.error}`);
        }
      }

      // Validate cart
      const cartItems = await validateCart(cartKey);
      console.log(`[TEST] Cart has ${cartItems.length} items after bulk add`);
      expect(cartItems.length).toBe(ITEMS.length);

      // Clean up
      for (const item of cartItems) {
        await removeItemFromCart(cartKey, item.cartItemId);
      }

      expect(failed.length).toBe(0);
    },
    300000
  );
});
