import { describe, it, expect } from "vitest";
import { solve } from "../../src/optimizer/solver";
import type { ModelInput } from "../../src/optimizer/types";

describe("solver integration", () => {
  it("solves a 3-card, 3-seller problem optimally", async () => {
    // Scenario: 3 cards, 3 sellers
    // SellerA: cheap cards, $0.99 shipping
    // SellerB: mid-price cards, $1.29 shipping
    // SellerD: slightly expensive cards, free shipping
    //
    // Optimal: buy all from SellerA (cheapest cards + only one shipping charge)
    const input: ModelInput = {
      cards: [
        { cartIndex: 0, productId: 1, name: "Llanowar Elves", currentPriceCents: 25 },
        { cartIndex: 1, productId: 2, name: "Lightning Bolt", currentPriceCents: 150 },
        { cartIndex: 2, productId: 3, name: "Counterspell", currentPriceCents: 75 },
      ],
      listingsPerCard: [
        // Card 0: Llanowar Elves
        [
          { listingId: "L001", sellerKey: "seller-a", priceCents: 20, shippingCents: 99 },
          { listingId: "L002", sellerKey: "seller-b", priceCents: 22, shippingCents: 129 },
          { listingId: "L004", sellerKey: "seller-d", priceCents: 30, shippingCents: 0 },
        ],
        // Card 1: Lightning Bolt
        [
          { listingId: "L101", sellerKey: "seller-a", priceCents: 125, shippingCents: 99 },
          { listingId: "L102", sellerKey: "seller-b", priceCents: 135, shippingCents: 129 },
          { listingId: "L104", sellerKey: "seller-d", priceCents: 140, shippingCents: 0 },
        ],
        // Card 2: Counterspell
        [
          { listingId: "L201", sellerKey: "seller-a", priceCents: 60, shippingCents: 99 },
          { listingId: "L202", sellerKey: "seller-b", priceCents: 65, shippingCents: 129 },
          { listingId: "L203", sellerKey: "seller-d", priceCents: 80, shippingCents: 0 },
        ],
      ],
    };

    const result = await solve(input);

    expect(result.status).toBe("Optimal");
    expect(result.solveTimeMs).toBeGreaterThan(0);

    // SellerA: 20 + 125 + 60 = 205 cards + 99 shipping = 304
    // SellerD: 30 + 140 + 80 = 250 cards + 0 shipping = 250
    // Best split: all from SellerD = 250, or all from SellerA = 304
    // Actually SellerD is cheapest total! 250 < 304
    expect(result.objectiveValue).toBe(250);
    expect(result.activeSellers.size).toBe(1);

    // All cards should come from seller-d
    expect(result.chosenListings.get(0)).toBe("L004");
    expect(result.chosenListings.get(1)).toBe("L104");
    expect(result.chosenListings.get(2)).toBe("L203");
  }, 10000);

  it("finds optimal split across sellers when shipping matters", async () => {
    // Scenario where splitting is optimal:
    // SellerA has cheap card0 but expensive shipping
    // SellerB has cheap card1 but expensive shipping
    // SellerC has both cards but mid-priced, with cheap shipping
    //
    // SellerC for both: 50 + 50 + 50 shipping = 150
    // SellerA for card0 + SellerB for card1: 10 + 10 + 200 + 200 = 420
    // Optimal = SellerC for both
    const input: ModelInput = {
      cards: [
        { cartIndex: 0, productId: 1, name: "Card 0", currentPriceCents: 100 },
        { cartIndex: 1, productId: 2, name: "Card 1", currentPriceCents: 100 },
      ],
      listingsPerCard: [
        [
          { listingId: "A0", sellerKey: "a", priceCents: 10, shippingCents: 200 },
          { listingId: "C0", sellerKey: "c", priceCents: 50, shippingCents: 50 },
        ],
        [
          { listingId: "B1", sellerKey: "b", priceCents: 10, shippingCents: 200 },
          { listingId: "C1", sellerKey: "c", priceCents: 50, shippingCents: 50 },
        ],
      ],
    };

    const result = await solve(input);
    expect(result.status).toBe("Optimal");
    // SellerC: 50 + 50 + 50 = 150
    expect(result.objectiveValue).toBe(150);
    expect(result.chosenListings.get(0)).toBe("C0");
    expect(result.chosenListings.get(1)).toBe("C1");
  }, 10000);

  it("handles card with no listings (infeasible)", async () => {
    const input: ModelInput = {
      cards: [
        { cartIndex: 0, productId: 1, name: "Missing Card", currentPriceCents: 100 },
      ],
      listingsPerCard: [
        [], // no listings
      ],
    };

    const result = await solve(input);
    expect(result.status).toBe("Infeasible");
  }, 10000);
});
