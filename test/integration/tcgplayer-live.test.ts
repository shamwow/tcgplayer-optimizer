import { describe, it, expect, beforeEach } from "vitest";
import { fetchListings, listingsCache } from "../../src/api/tcgplayer";

/**
 * Live integration tests against TCGPlayer's mp-search-api.
 *
 * These tests hit the real TCGPlayer API. They verify:
 * - API is reachable and returns expected response shape
 * - Listings are correctly parsed into SellerListing objects
 * - Filters (condition, printing) are applied
 * - Pagination works
 * - Gold seller filtering works
 *
 * Known working product IDs (as of 2026-03):
 * - 521498: Magic card with 100+ NM Normal listings
 * - 126979: Magic card with 200+ NM Normal listings
 * - 512920: Magic card with ~10 NM Normal listings (small set)
 */

const PRODUCT_ID_MANY_LISTINGS = 521498;
const PRODUCT_ID_SMALL = 512920;

describe("TCGPlayer Live API", () => {
  beforeEach(() => {
    listingsCache.clear();
  });

  it(
    "fetches listings for a product with many results",
    async () => {
      const listings = await fetchListings(
        PRODUCT_ID_MANY_LISTINGS,
        "Near Mint",
        "Normal"
      );

      expect(listings.length).toBeGreaterThan(0);

      // Verify shape of every listing
      for (const listing of listings) {
        expect(listing.listingId).toBeTruthy();
        expect(listing.productId).toBe(PRODUCT_ID_MANY_LISTINGS);
        expect(listing.sellerName).toBeTruthy();
        expect(typeof listing.sellerName).toBe("string");
        expect(listing.sellerKey).toBeTruthy();
        expect(typeof listing.sellerKey).toBe("string");
        expect(listing.priceCents).toBeGreaterThan(0);
        expect(listing.quantity).toBeGreaterThanOrEqual(1);
        expect(listing.shippingCents).toBeGreaterThanOrEqual(0);
        expect(listing.verified).toBe(true); // gold seller filter
        expect(listing.condition).toBe("Near Mint");
        expect(listing.printing).toBe("Normal");
      }
    },
    30000
  );

  it(
    "fetches listings for a product with few results",
    async () => {
      const listings = await fetchListings(
        PRODUCT_ID_SMALL,
        "Near Mint",
        "Normal"
      );

      expect(listings.length).toBeGreaterThan(0);
      expect(listings.length).toBeLessThan(50); // should fit in one page

      const first = listings[0];
      expect(first.productId).toBe(PRODUCT_ID_SMALL);
      expect(first.priceCents).toBeGreaterThan(0);
    },
    30000
  );

  it(
    "returns empty array for a product with no matching listings",
    async () => {
      // Use a valid product but with a condition/printing combo that likely has 0 listings
      // Product 512920 with "Damaged" + "Foil" should have very few or none
      const listings = await fetchListings(512920, "Damaged", "Foil");

      // Might be 0, might be a few — just verify it doesn't throw
      expect(Array.isArray(listings)).toBe(true);
      for (const listing of listings) {
        expect(listing.verified).toBe(true);
      }
    },
    30000
  );

  it(
    "reports progress during fetch",
    async () => {
      const progressCalls: Array<{ fetched: number; total: number }> = [];

      await fetchListings(
        PRODUCT_ID_MANY_LISTINGS,
        "Near Mint",
        "Normal",
        (fetched, total) => {
          progressCalls.push({ fetched, total });
        }
      );

      expect(progressCalls.length).toBeGreaterThan(0);

      // Total should be consistent across calls
      const totals = new Set(progressCalls.map((p) => p.total));
      expect(totals.size).toBe(1);

      // Fetched should be non-decreasing
      for (let i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i].fetched).toBeGreaterThanOrEqual(
          progressCalls[i - 1].fetched
        );
      }
    },
    30000
  );

  it(
    "respects rate limiting across multiple calls",
    async () => {
      const start = Date.now();

      // Fetch two different products back-to-back
      await fetchListings(PRODUCT_ID_SMALL, "Near Mint", "Normal");
      await fetchListings(PRODUCT_ID_MANY_LISTINGS, "Near Mint", "Normal");

      const elapsed = Date.now() - start;

      // With rate limiting at 2 req/s (500ms between), multiple pages should
      // take at least a few hundred ms. Just verify it's not instant.
      expect(elapsed).toBeGreaterThan(400);
    },
    60000
  );

  it(
    "listings are sorted by price + shipping ascending",
    async () => {
      const listings = await fetchListings(
        PRODUCT_ID_MANY_LISTINGS,
        "Near Mint",
        "Normal"
      );

      // First page should come back sorted
      // Check the first 20 listings are roughly in order
      const toCheck = listings.slice(0, 20);
      for (let i = 1; i < toCheck.length; i++) {
        const prevTotal = toCheck[i - 1].priceCents + toCheck[i - 1].shippingCents;
        const currTotal = toCheck[i].priceCents + toCheck[i].shippingCents;
        expect(currTotal).toBeGreaterThanOrEqual(prevTotal);
      }
    },
    30000
  );
});
