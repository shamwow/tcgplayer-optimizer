import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
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

  it("fewest-packages mode consolidates into fewer sellers", async () => {
    // In cheapest mode, splitting across 2 sellers is cheaper:
    //   SellerA card0 (10) + SellerB card1 (10) + shipping (50+50) = 120
    // But SellerC has both cards for more, 1 seller:
    //   SellerC card0 (50) + SellerC card1 (50) + shipping (50) = 150
    //
    // In fewest-packages mode, 1 seller (SellerC) should win over 2 sellers.
    const input: ModelInput = {
      cards: [
        { cartIndex: 0, productId: 1, name: "Card 0", currentPriceCents: 100 },
        { cartIndex: 1, productId: 2, name: "Card 1", currentPriceCents: 100 },
      ],
      listingsPerCard: [
        [
          { listingId: "A0", sellerKey: "a", priceCents: 10, shippingCents: 50 },
          { listingId: "C0", sellerKey: "c", priceCents: 50, shippingCents: 50 },
        ],
        [
          { listingId: "B1", sellerKey: "b", priceCents: 10, shippingCents: 50 },
          { listingId: "C1", sellerKey: "c", priceCents: 50, shippingCents: 50 },
        ],
      ],
      mode: "fewest-packages",
    };

    const result = await solve(input);
    expect(result.status).toBe("Optimal");
    // Should consolidate to 1 seller (SellerC) despite higher card cost
    expect(result.objectiveValue).toBe(150);
    expect(result.activeSellers.size).toBe(1);
    expect(result.chosenListings.get(0)).toBe("C0");
    expect(result.chosenListings.get(1)).toBe("C1");
  }, 10000);

  it("fewest-packages mode breaks seller-count ties by total cost", async () => {
    const input: ModelInput = {
      cards: [
        { cartIndex: 0, productId: 1, name: "Card 0", currentPriceCents: 100 },
        { cartIndex: 1, productId: 2, name: "Card 1", currentPriceCents: 100 },
      ],
      listingsPerCard: [
        [
          { listingId: "A0", sellerKey: "a", priceCents: 10, shippingCents: 100 },
          { listingId: "B0", sellerKey: "b", priceCents: 30, shippingCents: 10 },
          { listingId: "C0", sellerKey: "c", priceCents: 1, shippingCents: 0 },
        ],
        [
          { listingId: "A1", sellerKey: "a", priceCents: 10, shippingCents: 100 },
          { listingId: "B1", sellerKey: "b", priceCents: 30, shippingCents: 10 },
          { listingId: "D1", sellerKey: "d", priceCents: 1, shippingCents: 0 },
        ],
      ],
      mode: "fewest-packages",
    };

    const result = await solve(input);
    expect(result.status).toBe("Optimal");
    expect(result.objectiveValue).toBe(70);
    expect(result.activeSellers.size).toBe(1);
    expect(result.chosenListings.get(0)).toBe("B0");
    expect(result.chosenListings.get(1)).toBe("B1");
  }, 10000);

  it("fewest-packages mode handles many sellers without crashing", async () => {
    // Stress test: 20 cards, 200 listings each, 500 unique sellers
    // Simulates a realistic cart that previously crashed the WASM solver
    const numCards = 20;
    const numListingsPerCard = 200;
    const numUniqueSellers = 500;
    const cards = Array.from({ length: numCards }, (_, i) => ({
      cartIndex: i, productId: i + 1, name: `Card ${i}`, currentPriceCents: 5000,
    }));
    const listingsPerCard = cards.map((_, c) =>
      Array.from({ length: numListingsPerCard }, (_, s) => ({
        listingId: `L_${c}_${s}`,
        sellerKey: `seller-${s % numUniqueSellers}`,
        priceCents: 50 + ((s * 37 + c * 13) % 5000), // deterministic pseudo-random
        shippingCents: ((s * 7 + c * 3) % 500),
      }))
    );

    const input: ModelInput = { cards, listingsPerCard, mode: "fewest-packages" };
    const result = await solve(input);
    expect(result.status).toBe("Optimal");
    // Should consolidate into few sellers
    expect(result.activeSellers.size).toBeLessThanOrEqual(numCards);
    console.log(`Large fewest-packages: ${result.activeSellers.size} sellers, ${result.solveTimeMs}ms`);
  }, 30000);

  it("cheapest mode with captured 72-card cart fixture and shipping thresholds", async () => {
    const fixture = JSON.parse(
      readFileSync(resolve(__dirname, "../fixtures/live-72-card-cart.json"), "utf8")
    ) as {
      summary: { cardCount: number; totalListings: number; uniqueSellers: number; sellersWithThreshold?: number };
      cards: ModelInput["cards"];
      listingsPerCard: ModelInput["listingsPerCard"];
      sellerShipping?: Record<string, { shippingUnderCents: number; shippingOverCents: number; thresholdCents: number }>;
    };

    console.log(
      `Captured 72-card test: ${fixture.summary.cardCount} cards, ${fixture.summary.totalListings} total listings, ${fixture.summary.uniqueSellers} unique sellers, ${fixture.summary.sellersWithThreshold ?? 0} with threshold`
    );

    const sellerShipping = fixture.sellerShipping
      ? new Map(Object.entries(fixture.sellerShipping))
      : undefined;

    const input: ModelInput = {
      cards: fixture.cards,
      listingsPerCard: fixture.listingsPerCard,
      mode: "cheapest",
      sellerShipping,  // passed through for post-processing only
    };
    const result = await solve(input);
    console.log(`[TEST] Error: ${result.errorMessage}`);

    // Build listing lookup: listingId → listing data
    const listingById = new Map<string, { priceCents: number; shippingCents: number; sellerKey: string }>();
    for (const listings of fixture.listingsPerCard) {
      for (const l of listings) {
        listingById.set(l.listingId, l);
      }
    }

    // Compute item cost and per-seller subtotals
    let itemCostCents = 0;
    const sellerInfo = new Map<string, { count: number; subtotalCents: number; shippingCents: number }>();

    for (const [, listingId] of result.chosenListings) {
      const listing = listingById.get(listingId);
      if (!listing) continue;
      itemCostCents += listing.priceCents;
      if (!sellerInfo.has(listing.sellerKey)) {
        sellerInfo.set(listing.sellerKey, { count: 0, subtotalCents: 0, shippingCents: listing.shippingCents });
      }
      const si = sellerInfo.get(listing.sellerKey)!;
      si.count++;
      si.subtotalCents += listing.priceCents;
    }

    // Compute shipping with threshold awareness
    let shippingWithoutThreshold = 0;
    let shippingWithThreshold = 0;
    for (const [sellerKey, info] of sellerInfo) {
      shippingWithoutThreshold += info.shippingCents;

      const threshold = sellerShipping?.get(sellerKey);
      if (threshold && info.subtotalCents >= threshold.thresholdCents) {
        shippingWithThreshold += threshold.shippingOverCents;
      } else if (threshold) {
        shippingWithThreshold += threshold.shippingUnderCents;
      } else {
        shippingWithThreshold += info.shippingCents;
      }
    }

    console.log(
      `Captured cheapest: status=${result.status}, sellers=${sellerInfo.size}, objective=${result.objectiveValue}, ${result.solveTimeMs}ms`
    );
    console.log(`  Item cost: $${(itemCostCents / 100).toFixed(2)}`);
    console.log(`  Shipping (no thresholds): $${(shippingWithoutThreshold / 100).toFixed(2)}`);
    console.log(`  Shipping (with thresholds): $${(shippingWithThreshold / 100).toFixed(2)}`);
    console.log(`  Total (no thresholds): $${((itemCostCents + shippingWithoutThreshold) / 100).toFixed(2)}`);
    console.log(`  Total (with thresholds): $${((itemCostCents + shippingWithThreshold) / 100).toFixed(2)}`);

    // Show top sellers by item count
    const sorted = [...sellerInfo.entries()].sort((a, b) => b[1].count - a[1].count);
    console.log(`\n  Top sellers:`);
    for (const [key, info] of sorted.slice(0, 10)) {
      const threshold = sellerShipping?.get(key);
      const ship = threshold && info.subtotalCents >= threshold.thresholdCents
        ? threshold.shippingOverCents : (threshold?.shippingUnderCents ?? info.shippingCents);
      console.log(`    ${key}: ${info.count} items, subtotal=$${(info.subtotalCents / 100).toFixed(2)}, ship=$${(ship / 100).toFixed(2)}${threshold && info.subtotalCents >= threshold.thresholdCents ? ' (threshold met)' : ''}`);
    }

    expect(result.status).toBe("Optimal");
    expect(sellerInfo.size).toBeGreaterThan(0);
  }, 180000);

  it("fewest-packages mode with captured 72-card cart fixture", async () => {
    const fixture = JSON.parse(
      readFileSync(resolve(__dirname, "../fixtures/live-72-card-cart.json"), "utf8")
    ) as {
      summary: { cardCount: number; totalListings: number; uniqueSellers: number };
      cards: ModelInput["cards"];
      listingsPerCard: ModelInput["listingsPerCard"];
    };

    console.log(
      `Captured 72-card test: ${fixture.summary.cardCount} cards, ${fixture.summary.totalListings} total listings, ${fixture.summary.uniqueSellers} unique sellers`
    );

    const input: ModelInput = {
      cards: fixture.cards,
      listingsPerCard: fixture.listingsPerCard,
      mode: "fewest-packages",
    };
    const result = await solve(input);
    console.log(
      `Captured fewest-packages: status=${result.status}, error=${result.errorMessage}, sellers=${result.activeSellers.size}, objective=${result.objectiveValue}, ${result.solveTimeMs}ms`
    );
    expect(result.status).toBe("Optimal");
    expect(result.activeSellers.size).toBeGreaterThan(0);
  }, 180000);

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
