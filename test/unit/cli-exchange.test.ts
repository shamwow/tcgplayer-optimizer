import { describe, expect, it } from "vitest";
import { matchCliOutputToItems, parseCliOptimizerOutput } from "../../src/cli/exchange";
import type { CartItem } from "../../src/types";

function makeItem(overrides: Partial<CartItem>): CartItem {
  return {
    cartIndex: 0,
    productId: 1,
    sku: 100,
    name: "Card",
    condition: "Near Mint",
    printing: "Normal",
    setName: "Set",
    rarity: "Rare",
    quantity: 1,
    currentPriceCents: 100,
    currentSeller: "Seller",
    currentSellerKey: "seller-key",
    ...overrides,
  };
}

describe("cli exchange", () => {
  it("parses valid CLI output JSON", () => {
    const output = parseCliOptimizerOutput(JSON.stringify({
      format: "tcgplayer-optimizer-cli-output",
      version: 1,
      generatedAt: "2026-03-19T00:00:00.000Z",
      objectiveCents: 123,
      itemCostCents: 100,
      shippingCents: 23,
      sellerCount: 1,
      solveTimeMs: 10,
      assignments: [{ sku: 100, sellerId: 42 }],
    }));

    expect(output.assignments).toHaveLength(1);
    expect(output.assignments[0].sellerId).toBe(42);
  });

  it("matches CLI assignments by cartIndex first, then by sku", () => {
    const items = [
      makeItem({ cartIndex: 2, sku: 100 }),
      makeItem({ cartIndex: 3, sku: 100 }),
      makeItem({ cartIndex: 4, sku: 200 }),
    ];

    const matched = matchCliOutputToItems(items, {
      format: "tcgplayer-optimizer-cli-output",
      version: 1,
      generatedAt: "2026-03-19T00:00:00.000Z",
      objectiveCents: 123,
      itemCostCents: 100,
      shippingCents: 23,
      sellerCount: 2,
      solveTimeMs: 10,
      assignments: [
        { cartIndex: 3, sku: 100, sellerId: 22 },
        { sku: 100, sellerId: 11 },
        { sku: 200, sellerId: 33 },
      ],
    });

    expect(matched.map((entry) => [entry.item.cartIndex, entry.assignment.sellerId])).toEqual([
      [2, 11],
      [3, 22],
      [4, 33],
    ]);
  });

  it("rejects extra SKU assignments", () => {
    const items = [makeItem({ cartIndex: 1, sku: 100 })];

    expect(() => matchCliOutputToItems(items, {
      format: "tcgplayer-optimizer-cli-output",
      version: 1,
      generatedAt: "2026-03-19T00:00:00.000Z",
      objectiveCents: 123,
      itemCostCents: 100,
      shippingCents: 23,
      sellerCount: 1,
      solveTimeMs: 10,
      assignments: [
        { sku: 100, sellerId: 11 },
        { sku: 100, sellerId: 12 },
      ],
    })).toThrow("extra assignment");
  });

  it("keeps items on the current seller when the CLI output omits that sku entirely", () => {
    const items = [
      makeItem({ cartIndex: 1, sku: 100 }),
      makeItem({ cartIndex: 2, sku: 200 }),
    ];

    const matched = matchCliOutputToItems(items, {
      format: "tcgplayer-optimizer-cli-output",
      version: 1,
      generatedAt: "2026-03-19T00:00:00.000Z",
      objectiveCents: 123,
      itemCostCents: 100,
      shippingCents: 23,
      sellerCount: 1,
      solveTimeMs: 10,
      assignments: [{ sku: 100, sellerId: 11 }],
    });

    expect(matched.map((entry) => entry.assignment?.sellerId ?? null)).toEqual([11, null]);
  });
});
