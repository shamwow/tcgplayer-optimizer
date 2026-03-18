import { describe, it, expect } from "vitest";
import { buildLpModel, buildVariableMap } from "../../src/optimizer/model";
import type { ModelInput } from "../../src/optimizer/types";

function makeInput(): ModelInput {
  return {
    cards: [
      { cartIndex: 0, productId: 1, name: "Card A", currentPriceCents: 100 },
      { cartIndex: 1, productId: 2, name: "Card B", currentPriceCents: 200 },
    ],
    listingsPerCard: [
      [
        { listingId: "L1", sellerKey: "seller-a", priceCents: 90, shippingCents: 99 },
        { listingId: "L2", sellerKey: "seller-b", priceCents: 85, shippingCents: 129 },
      ],
      [
        { listingId: "L3", sellerKey: "seller-a", priceCents: 180, shippingCents: 99 },
        { listingId: "L4", sellerKey: "seller-c", priceCents: 175, shippingCents: 150 },
      ],
    ],
  };
}

describe("buildLpModel", () => {
  it("generates valid CPLEX LP format", () => {
    const input = makeInput();
    const lp = buildLpModel(input);

    // Should have standard LP sections
    expect(lp).toContain("Minimize");
    expect(lp).toContain("Subject To");
    expect(lp).toContain("Binary");
    expect(lp).toContain("End");

    // Should have card price terms
    expect(lp).toContain("90 x_0_0");
    expect(lp).toContain("85 x_0_1");
    expect(lp).toContain("180 x_1_0");
    expect(lp).toContain("175 x_1_1");

    // Should have shipping terms
    expect(lp).toContain("y_seller_a");
    expect(lp).toContain("y_seller_b");
    expect(lp).toContain("y_seller_c");

    // Each card bought exactly once
    expect(lp).toContain("card_0: x_0_0 + x_0_1 = 1");
    expect(lp).toContain("card_1: x_1_0 + x_1_1 = 1");

    // Linking constraints
    expect(lp).toContain("x_0_0 - y_seller_a <= 0");
    expect(lp).toContain("x_0_1 - y_seller_b <= 0");
    expect(lp).toContain("x_1_0 - y_seller_a <= 0");
    expect(lp).toContain("x_1_1 - y_seller_c <= 0");
  });

  it("uses minimum shipping per seller", () => {
    const input: ModelInput = {
      cards: [
        { cartIndex: 0, productId: 1, name: "Card A", currentPriceCents: 100 },
      ],
      listingsPerCard: [
        [
          { listingId: "L1", sellerKey: "seller-a", priceCents: 90, shippingCents: 150 },
          { listingId: "L2", sellerKey: "seller-a", priceCents: 95, shippingCents: 99 },
        ],
      ],
    };
    const lp = buildLpModel(input);
    // Shipping for seller-a should be the minimum (99)
    expect(lp).toContain("99 y_seller_a");
    expect(lp).not.toContain("150 y_seller_a");
  });
});

describe("buildVariableMap", () => {
  it("maps variable names to card index and listing ID", () => {
    const input = makeInput();
    const map = buildVariableMap(input);

    expect(map.get("x_0_0")).toEqual({ cardIndex: 0, listingId: "L1" });
    expect(map.get("x_0_1")).toEqual({ cardIndex: 0, listingId: "L2" });
    expect(map.get("x_1_0")).toEqual({ cardIndex: 1, listingId: "L3" });
    expect(map.get("x_1_1")).toEqual({ cardIndex: 1, listingId: "L4" });
  });
});
