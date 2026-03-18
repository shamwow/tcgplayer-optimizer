import type { OptimizationResult } from "@/types";

/**
 * Phase 2: Apply optimized cart by manipulating TCGPlayer's cart.
 * For now, we export the optimized list as text for Mass Entry.
 */
export function formatOptimizedListForMassEntry(
  result: OptimizationResult
): string {
  const lines: string[] = [];

  for (const seller of result.sellers) {
    lines.push(`// Seller: ${seller.sellerName}`);
    for (const item of seller.items) {
      // Mass Entry format: "1 Card Name"
      lines.push(`1 ${item.name}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Format results as deep links to individual seller storefronts.
 * Each seller link contains all items from that seller.
 */
export function formatSellerLinks(
  result: OptimizationResult
): Array<{ sellerName: string; url: string; itemCount: number }> {
  return result.sellers.map((seller) => ({
    sellerName: seller.sellerName,
    url: `https://www.tcgplayer.com/search/all/product?seller=${encodeURIComponent(seller.sellerKey)}`,
    itemCount: seller.items.length,
  }));
}
