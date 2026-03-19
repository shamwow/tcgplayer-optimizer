import { readFileSync } from "fs";
import { resolve } from "path";
import type { ModelInput } from "../../src/optimizer/types";
import type { SellerShippingThreshold } from "../../src/optimizer/types";
import { describe, it, expect } from "vitest";

interface Listing { listingId: string; sellerKey: string; priceCents: number; shippingCents: number }

function computeTotalCost(
  assignment: Map<number, string>,
  listingById: Map<string, Listing>,
  sellerShipping: Map<string, SellerShippingThreshold>
): { total: number; itemCost: number; shipping: number; sellerCount: number } {
  const sellers = new Map<string, { subtotal: number; shipFallback: number }>();
  let itemCost = 0;
  for (const lid of assignment.values()) {
    const l = listingById.get(lid)!;
    itemCost += l.priceCents;
    if (!sellers.has(l.sellerKey)) sellers.set(l.sellerKey, { subtotal: 0, shipFallback: l.shippingCents });
    sellers.get(l.sellerKey)!.subtotal += l.priceCents;
  }
  let shipping = 0;
  for (const [sk, info] of sellers) {
    const t = sellerShipping.get(sk);
    if (t) {
      shipping += info.subtotal >= t.thresholdCents ? t.shippingOverCents : t.shippingUnderCents;
    } else {
      shipping += info.shipFallback;
    }
  }
  return { total: itemCost + shipping, itemCost, shipping, sellerCount: sellers.size };
}

function localSearch(
  assignment: Map<number, string>,
  listingsPerCard: Listing[][],
  listingById: Map<string, Listing>,
  sellerShipping: Map<string, SellerShippingThreshold>,
  maxPasses: number
): number {
  let currentCost = computeTotalCost(assignment, listingById, sellerShipping).total;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (let c = 0; c < listingsPerCard.length; c++) {
      if (!assignment.has(c)) continue;
      const curr = assignment.get(c)!;
      let bestId: string | null = null;
      let bestCost = currentCost;
      for (const cand of listingsPerCard[c]) {
        if (cand.listingId === curr) continue;
        assignment.set(c, cand.listingId);
        const cost = computeTotalCost(assignment, listingById, sellerShipping).total;
        if (cost < bestCost) { bestCost = cost; bestId = cand.listingId; }
        assignment.set(c, curr);
      }
      if (bestId) { assignment.set(c, bestId); currentCost = bestCost; improved = true; }
    }
    if (!improved) break;
  }
  return currentCost;
}

describe("find optimal", () => {
  it("exhaustive search", async () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../test/fixtures/live-72-card-cart.json"), "utf8"));
    const sellerShipping = new Map(Object.entries(fixture.sellerShipping ?? {})) as Map<string, SellerShippingThreshold>;
    const listingsPerCard: Listing[][] = fixture.listingsPerCard;

    const listingById = new Map<string, Listing>();
    for (const listings of listingsPerCard) for (const l of listings) listingById.set(l.listingId, l);

    // Find cards with listings
    const validCards: number[] = [];
    for (let i = 0; i < listingsPerCard.length; i++) {
      if (listingsPerCard[i].length > 0) validCards.push(i);
    }

    let globalBest = Infinity;
    let globalBestAssignment: Map<number, string> | null = null;

    // Strategy 1: Cheapest item price first
    {
      const a = new Map<number, string>();
      for (const c of validCards) {
        let best = listingsPerCard[c][0];
        for (const l of listingsPerCard[c]) if (l.priceCents < best.priceCents) best = l;
        a.set(c, best.listingId);
      }
      const cost = localSearch(a, listingsPerCard, listingById, sellerShipping, 100);
      console.log("Strategy 1 (cheapest price): $" + (cost / 100).toFixed(2));
      if (cost < globalBest) { globalBest = cost; globalBestAssignment = new Map(a); }
    }

    // Strategy 2: Cheapest price+shipping first
    {
      const a = new Map<number, string>();
      for (const c of validCards) {
        let best = listingsPerCard[c][0];
        let bestTotal = best.priceCents + best.shippingCents;
        for (const l of listingsPerCard[c]) {
          const t = l.priceCents + l.shippingCents;
          if (t < bestTotal) { bestTotal = t; best = l; }
        }
        a.set(c, best.listingId);
      }
      const cost = localSearch(a, listingsPerCard, listingById, sellerShipping, 100);
      console.log("Strategy 2 (cheapest total): $" + (cost / 100).toFixed(2));
      if (cost < globalBest) { globalBest = cost; globalBestAssignment = new Map(a); }
    }

    // Strategy 3: Greedy with shipping awareness (expensive cards first)
    {
      const a = new Map<number, string>();
      const subtotals = new Map<string, number>();
      const order = [...validCards].sort((x, y) => {
        const maxX = Math.max(...listingsPerCard[x].map(l => l.priceCents));
        const maxY = Math.max(...listingsPerCard[y].map(l => l.priceCents));
        return maxY - maxX;
      });
      for (const c of order) {
        let bestId = listingsPerCard[c][0].listingId;
        let bestMarginal = Infinity;
        for (const l of listingsPerCard[c]) {
          const curSub = subtotals.get(l.sellerKey) ?? 0;
          const newSub = curSub + l.priceCents;
          const isNew = curSub === 0;
          let shipDelta = 0;
          if (isNew) {
            const t = sellerShipping.get(l.sellerKey);
            shipDelta = t ? (newSub >= t.thresholdCents ? t.shippingOverCents : t.shippingUnderCents) : l.shippingCents;
          } else {
            const t = sellerShipping.get(l.sellerKey);
            if (t && curSub < t.thresholdCents && newSub >= t.thresholdCents) {
              shipDelta = t.shippingOverCents - t.shippingUnderCents;
            }
          }
          const marginal = l.priceCents + shipDelta;
          if (marginal < bestMarginal) { bestMarginal = marginal; bestId = l.listingId; }
        }
        a.set(c, bestId);
        const chosen = listingById.get(bestId)!;
        subtotals.set(chosen.sellerKey, (subtotals.get(chosen.sellerKey) ?? 0) + chosen.priceCents);
      }
      const cost = localSearch(a, listingsPerCard, listingById, sellerShipping, 100);
      console.log("Strategy 3 (shipping-aware greedy): $" + (cost / 100).toFixed(2));
      if (cost < globalBest) { globalBest = cost; globalBestAssignment = new Map(a); }
    }

    // Strategy 4: Greedy with shipping awareness (cheapest cards first)
    {
      const a = new Map<number, string>();
      const subtotals = new Map<string, number>();
      const order = [...validCards].sort((x, y) => {
        const minX = Math.min(...listingsPerCard[x].map(l => l.priceCents));
        const minY = Math.min(...listingsPerCard[y].map(l => l.priceCents));
        return minX - minY;
      });
      for (const c of order) {
        let bestId = listingsPerCard[c][0].listingId;
        let bestMarginal = Infinity;
        for (const l of listingsPerCard[c]) {
          const curSub = subtotals.get(l.sellerKey) ?? 0;
          const newSub = curSub + l.priceCents;
          const isNew = curSub === 0;
          let shipDelta = 0;
          if (isNew) {
            const t = sellerShipping.get(l.sellerKey);
            shipDelta = t ? (newSub >= t.thresholdCents ? t.shippingOverCents : t.shippingUnderCents) : l.shippingCents;
          } else {
            const t = sellerShipping.get(l.sellerKey);
            if (t && curSub < t.thresholdCents && newSub >= t.thresholdCents) {
              shipDelta = t.shippingOverCents - t.shippingUnderCents;
            }
          }
          const marginal = l.priceCents + shipDelta;
          if (marginal < bestMarginal) { bestMarginal = marginal; bestId = l.listingId; }
        }
        a.set(c, bestId);
        const chosen = listingById.get(bestId)!;
        subtotals.set(chosen.sellerKey, (subtotals.get(chosen.sellerKey) ?? 0) + chosen.priceCents);
      }
      const cost = localSearch(a, listingsPerCard, listingById, sellerShipping, 100);
      console.log("Strategy 4 (shipping-aware, cheap first): $" + (cost / 100).toFixed(2));
      if (cost < globalBest) { globalBest = cost; globalBestAssignment = new Map(a); }
    }

    // Strategy 5-14: Random starting orderings with shipping-aware greedy
    for (let trial = 0; trial < 10; trial++) {
      const a = new Map<number, string>();
      const subtotals = new Map<string, number>();
      const order = [...validCards].sort(() => Math.random() - 0.5);
      for (const c of order) {
        let bestId = listingsPerCard[c][0].listingId;
        let bestMarginal = Infinity;
        for (const l of listingsPerCard[c]) {
          const curSub = subtotals.get(l.sellerKey) ?? 0;
          const newSub = curSub + l.priceCents;
          const isNew = curSub === 0;
          let shipDelta = 0;
          if (isNew) {
            const t = sellerShipping.get(l.sellerKey);
            shipDelta = t ? (newSub >= t.thresholdCents ? t.shippingOverCents : t.shippingUnderCents) : l.shippingCents;
          } else {
            const t = sellerShipping.get(l.sellerKey);
            if (t && curSub < t.thresholdCents && newSub >= t.thresholdCents) {
              shipDelta = t.shippingOverCents - t.shippingUnderCents;
            }
          }
          const marginal = l.priceCents + shipDelta;
          if (marginal < bestMarginal) { bestMarginal = marginal; bestId = l.listingId; }
        }
        a.set(c, bestId);
        const chosen = listingById.get(bestId)!;
        subtotals.set(chosen.sellerKey, (subtotals.get(chosen.sellerKey) ?? 0) + chosen.priceCents);
      }
      const cost = localSearch(a, listingsPerCard, listingById, sellerShipping, 100);
      console.log(`Strategy ${5 + trial} (random ${trial + 1}): $${(cost / 100).toFixed(2)}`);
      if (cost < globalBest) { globalBest = cost; globalBestAssignment = new Map(a); }
    }

    // Final result
    const best = computeTotalCost(globalBestAssignment!, listingById, sellerShipping);
    console.log(`\n=== BEST SOLUTION ===`);
    console.log(`Item cost: $${(best.itemCost / 100).toFixed(2)}`);
    console.log(`Shipping: $${(best.shipping / 100).toFixed(2)}`);
    console.log(`Total: $${(best.total / 100).toFixed(2)}`);
    console.log(`Sellers: ${best.sellerCount}`);

    expect(best.total).toBeGreaterThan(0);
  }, 600000);
});
