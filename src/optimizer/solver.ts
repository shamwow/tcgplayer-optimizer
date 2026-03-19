import type { ModelInput, SolverResult, SellerShippingThreshold } from "./types";
import { solveFewestPackagesExact } from "./fewest-packages";

/**
 * Solve the cart optimization problem using a greedy algorithm with local search.
 *
 * Phase 1 (Greedy): Assign each card to its cheapest listing.
 * Phase 2 (Consolidation): Move items to sellers who already have items,
 *          accepting moves that reduce total cost (item price + threshold-aware shipping).
 * Phase 3 (Local search): Try swapping each card to any alternative listing,
 *          accept the best improving swap, repeat until no improvement.
 */
export async function solve(input: ModelInput): Promise<SolverResult> {
  const startTime = performance.now();

  // Pre-solve: filter out cards with no listings
  const filteredCards = [];
  const filteredListings = [];
  for (let i = 0; i < input.cards.length; i++) {
    if (input.listingsPerCard[i].length > 0) {
      filteredCards.push(input.cards[i]);
      filteredListings.push(input.listingsPerCard[i]);
    }
  }

  if (filteredCards.length === 0) {
    return {
      status: "Infeasible",
      objectiveValue: 0,
      chosenListings: new Map(),
      activeSellers: new Set(),
      solveTimeMs: Math.round(performance.now() - startTime),
      errorMessage: "No listings found for any cards in the cart.",
    };
  }

  const filteredInput: ModelInput = {
    cards: filteredCards,
    listingsPerCard: filteredListings,
    mode: input.mode,
    sellerShipping: input.sellerShipping,
  };

  if (filteredInput.mode === "fewest-packages") {
    try {
      return solveFewestPackagesExact(filteredInput, startTime);
    } catch (err) {
      return {
        status: "Error",
        objectiveValue: 0,
        chosenListings: new Map(),
        activeSellers: new Set(),
        solveTimeMs: Math.round(performance.now() - startTime),
        errorMessage: err instanceof Error ? err.message : "Seller search failed",
      };
    }
  }

  try {
    const result = solveCheapestGreedy(filteredInput, startTime);
    return result;
  } catch (err) {
    return {
      status: "Error",
      objectiveValue: 0,
      chosenListings: new Map(),
      activeSellers: new Set(),
      solveTimeMs: Math.round(performance.now() - startTime),
      errorMessage: err instanceof Error ? err.message : "Solver failed",
    };
  }
}

/**
 * Greedy solver with local search for cheapest mode.
 */
function solveCheapestGreedy(input: ModelInput, startTime: number): SolverResult {
  const { listingsPerCard, sellerShipping } = input;
  const totalListings = listingsPerCard.reduce((s, l) => s + l.length, 0);
  console.log(`[Solver] Greedy solver: ${listingsPerCard.length} cards, ${totalListings} listings`);

  // Build listing lookup
  const listingById = new Map<string, { sellerKey: string; priceCents: number; shippingCents: number }>();
  for (const listings of listingsPerCard) {
    for (const l of listings) {
      listingById.set(l.listingId, l);
    }
  }

  // --- Phase 1: Greedy initial assignment ---
  // For each card, pick the listing with lowest price + shipping.
  // As sellers accumulate items, re-evaluate shipping (threshold-aware).
  const assignment = new Map<number, string>();
  const sellerSubtotals = new Map<string, number>();

  // Sort cards by most expensive first — assign expensive cards first to build seller subtotals toward thresholds
  const cardOrder = Array.from({ length: listingsPerCard.length }, (_, i) => i);
  cardOrder.sort((a, b) => {
    const maxA = Math.max(...listingsPerCard[a].map((l) => l.priceCents));
    const maxB = Math.max(...listingsPerCard[b].map((l) => l.priceCents));
    return maxB - maxA;
  });

  for (const c of cardOrder) {
    let bestId = listingsPerCard[c][0].listingId;
    let bestCost = Infinity;

    for (const l of listingsPerCard[c]) {
      const currentSubtotal = sellerSubtotals.get(l.sellerKey) ?? 0;
      const newSubtotal = currentSubtotal + l.priceCents;
      const isNewSeller = currentSubtotal === 0;

      // Compute marginal shipping cost of using this seller
      let shippingDelta = 0;
      if (isNewSeller) {
        const threshold = sellerShipping?.get(l.sellerKey);
        if (threshold) {
          shippingDelta = newSubtotal >= threshold.thresholdCents
            ? threshold.shippingOverCents
            : threshold.shippingUnderCents;
        } else {
          shippingDelta = l.shippingCents;
        }
      } else {
        // Seller already active — check if we cross the threshold
        const threshold = sellerShipping?.get(l.sellerKey);
        if (threshold && currentSubtotal < threshold.thresholdCents && newSubtotal >= threshold.thresholdCents) {
          // Crossing threshold: shipping drops
          shippingDelta = threshold.shippingOverCents - threshold.shippingUnderCents;
        }
      }

      const totalCost = l.priceCents + shippingDelta;
      if (totalCost < bestCost) {
        bestCost = totalCost;
        bestId = l.listingId;
      }
    }

    assignment.set(c, bestId);
    const chosen = listingById.get(bestId)!;
    sellerSubtotals.set(chosen.sellerKey, (sellerSubtotals.get(chosen.sellerKey) ?? 0) + chosen.priceCents);
  }

  const initialCost = computeTotalCost(assignment, listingById, sellerShipping);
  console.log(`[Solver] Phase 1 (greedy): $${(initialCost / 100).toFixed(2)}`);

  // --- Phase 2 & 3: Local search with threshold-aware swaps ---
  let currentCost = initialCost;
  let improved = true;
  let passes = 0;
  const maxPasses = 50;

  while (improved && passes < maxPasses) {
    improved = false;
    passes++;

    for (let cardIdx = 0; cardIdx < listingsPerCard.length; cardIdx++) {
      const currentListingId = assignment.get(cardIdx)!;

      let bestSwapId: string | null = null;
      let bestCost = currentCost;

      for (const candidate of listingsPerCard[cardIdx]) {
        if (candidate.listingId === currentListingId) continue;

        // Tentatively swap
        assignment.set(cardIdx, candidate.listingId);
        const newCost = computeTotalCost(assignment, listingById, sellerShipping);

        if (newCost < bestCost) {
          bestCost = newCost;
          bestSwapId = candidate.listingId;
        }

        // Revert
        assignment.set(cardIdx, currentListingId);
      }

      if (bestSwapId) {
        assignment.set(cardIdx, bestSwapId);
        currentCost = bestCost;
        improved = true;
      }
    }

    console.log(`[Solver] Pass ${passes}: $${(currentCost / 100).toFixed(2)}`);
  }

  // Build result
  const activeSellers = new Set<string>();
  for (const listingId of assignment.values()) {
    const l = listingById.get(listingId);
    if (l) activeSellers.add(l.sellerKey);
  }

  const solveTimeMs = Math.round(performance.now() - startTime);
  console.log(`[Solver] Done: $${(currentCost / 100).toFixed(2)}, ${activeSellers.size} sellers, ${passes} passes, ${solveTimeMs}ms`);

  return {
    status: "Optimal",
    objectiveValue: currentCost,
    chosenListings: assignment,
    activeSellers,
    solveTimeMs,
  };
}

/**
 * Compute total cost of an assignment with threshold-aware shipping.
 */
function computeTotalCost(
  assignment: Map<number, string>,
  listingById: Map<string, { sellerKey: string; priceCents: number; shippingCents: number }>,
  sellerShipping?: Map<string, SellerShippingThreshold>
): number {
  // Accumulate per-seller subtotals
  const sellers = new Map<string, { subtotalCents: number; shippingCents: number }>();
  let itemTotal = 0;

  for (const listingId of assignment.values()) {
    const l = listingById.get(listingId);
    if (!l) continue;
    itemTotal += l.priceCents;
    if (!sellers.has(l.sellerKey)) {
      sellers.set(l.sellerKey, { subtotalCents: 0, shippingCents: l.shippingCents });
    }
    sellers.get(l.sellerKey)!.subtotalCents += l.priceCents;
  }

  // Compute shipping with threshold awareness
  let shippingTotal = 0;
  for (const [sellerKey, info] of sellers) {
    const threshold = sellerShipping?.get(sellerKey);
    if (threshold) {
      shippingTotal += info.subtotalCents >= threshold.thresholdCents
        ? threshold.shippingOverCents
        : threshold.shippingUnderCents;
    } else {
      shippingTotal += info.shippingCents;
    }
  }

  return itemTotal + shippingTotal;
}
