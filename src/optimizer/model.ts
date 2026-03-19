import type { ModelInput } from "./types";

/**
 * Build a CPLEX LP format string for the cart optimization problem.
 *
 * Variables:
 *   x_<cardIdx>_<listingIdx> ∈ {0,1} — buy card cardIdx from listing listingIdx
 *   y_<sellerKey>            ∈ {0,1} — use seller (triggers shipping cost)
 *
 * Minimize:
 *   Σ price[l]·x[l] + Σ shipping[s]·y[s]
 *
 * Subject to:
 *   ∀ card c: Σ x[l] where card(l)=c  = 1   (buy every card exactly once)
 *   ∀ listing l: x[l] ≤ y[seller(l)]         (seller active if buying from them)
 */
export function buildLpModel(input: ModelInput): string {
  const { cards, listingsPerCard, mode } = input;

  // Collect unique sellers and their shipping costs
  const sellerShipping = new Map<string, number>();
  for (const listings of listingsPerCard) {
    for (const listing of listings) {
      if (
        !sellerShipping.has(listing.sellerKey) ||
        sellerShipping.get(listing.sellerKey)! > listing.shippingCents
      ) {
        // Use the minimum shipping for each seller (seller-level cost)
        sellerShipping.set(listing.sellerKey, listing.shippingCents);
      }
    }
  }

  // For fewest-packages mode, scale costs into the fractional part of the objective
  // so that seller count (integer part) always dominates.
  //   min Σ 1·y_s + (1/scale)·(Σ price·x + Σ shipping·y)
  // where scale > max possible total cost, ensuring all cost terms sum to < 1.
  // This avoids large big-M coefficients that crash the WASM solver.
  let costScale = 1;
  if (mode === "fewest-packages") {
    let maxTotalCost = 0;
    for (const listings of listingsPerCard) {
      let maxPrice = 0;
      for (const listing of listings) {
        if (listing.priceCents > maxPrice) maxPrice = listing.priceCents;
      }
      maxTotalCost += maxPrice;
    }
    let maxShipping = 0;
    for (const shipping of sellerShipping.values()) {
      if (shipping > maxShipping) maxShipping = shipping;
    }
    maxTotalCost += maxShipping * cards.length;
    costScale = maxTotalCost + 1;
  }

  const lines: string[] = [];

  // Objective
  lines.push("Minimize");
  const objTerms: string[] = [];

  for (let c = 0; c < cards.length; c++) {
    for (let l = 0; l < listingsPerCard[c].length; l++) {
      const price = listingsPerCard[c][l].priceCents;
      const coeff = mode === "fewest-packages" ? price / costScale : price;
      objTerms.push(`${coeff} x_${c}_${l}`);
    }
  }

  for (const [sellerKey, shipping] of sellerShipping) {
    const safeKey = sanitizeVarName(sellerKey);
    const sellerCoeff = mode === "fewest-packages"
      ? 1 + shipping / costScale
      : shipping;
    objTerms.push(`${sellerCoeff} y_${safeKey}`);
  }

  lines.push("  obj: " + objTerms.join(" + "));

  // Constraints
  lines.push("Subject To");

  // Each card must be bought exactly once
  for (let c = 0; c < cards.length; c++) {
    const terms = listingsPerCard[c].map((_, l) => `x_${c}_${l}`);
    if (terms.length === 0) {
      // No listings for this card — infeasible
      lines.push(`  card_${c}: x_infeasible_${c} = 1`);
    } else {
      lines.push(`  card_${c}: ${terms.join(" + ")} = 1`);
    }
  }

  // If buying from a listing, that seller must be active
  for (let c = 0; c < cards.length; c++) {
    for (let l = 0; l < listingsPerCard[c].length; l++) {
      const sellerKey = listingsPerCard[c][l].sellerKey;
      const safeKey = sanitizeVarName(sellerKey);
      lines.push(`  link_${c}_${l}: x_${c}_${l} - y_${safeKey} <= 0`);
    }
  }

  // Binary variable declarations
  lines.push("Binary");
  const binVars: string[] = [];
  for (let c = 0; c < cards.length; c++) {
    for (let l = 0; l < listingsPerCard[c].length; l++) {
      binVars.push(`  x_${c}_${l}`);
    }
  }
  for (const sellerKey of sellerShipping.keys()) {
    binVars.push(`  y_${sanitizeVarName(sellerKey)}`);
  }
  lines.push(binVars.join("\n"));

  lines.push("End");

  return lines.join("\n");
}

/** Make a seller key safe for use as a CPLEX variable name */
function sanitizeVarName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Build a variable-name-to-listing-id mapping for interpreting solver output.
 */
export function buildVariableMap(
  input: ModelInput
): Map<string, { cardIndex: number; listingId: string }> {
  const map = new Map<string, { cardIndex: number; listingId: string }>();
  for (let c = 0; c < input.cards.length; c++) {
    for (let l = 0; l < input.listingsPerCard[c].length; l++) {
      map.set(`x_${c}_${l}`, {
        cardIndex: c,
        listingId: input.listingsPerCard[c][l].listingId,
      });
    }
  }
  return map;
}
