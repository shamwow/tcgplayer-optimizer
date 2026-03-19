import type { CliOptimizerInput, CliOptimizerOutput } from "../cli/types";

/** A card the user wants to buy, parsed from the cart DOM */
export interface CartItem {
  /** Unique identifier within this cart (index-based) */
  cartIndex: number;
  /** TCGPlayer product ID (extracted from product URL) */
  productId: number;
  /** TCGPlayer SKU (product variant: product + condition + printing) */
  sku: number;
  /** Card name as displayed in the cart */
  name: string;
  /** e.g. "Near Mint", "Lightly Played" */
  condition: string;
  /** e.g. "Normal", "Foil" */
  printing: string;
  /** Set name, e.g. "Foundations" */
  setName: string;
  /** Rarity, e.g. "Rare" */
  rarity: string;
  /** Quantity desired */
  quantity: number;
  /** Current price in the user's cart (cents) */
  currentPriceCents: number;
  /** Current seller in the user's cart */
  currentSeller: string;
  /** Current seller key in the user's cart */
  currentSellerKey: string;
}

/** A listing from a seller for a specific product */
export interface SellerListing {
  /** TCGPlayer listing ID */
  listingId: string;
  /** Product ID this listing is for */
  productId: number;
  /** Seller name */
  sellerName: string;
  /** Seller key (hash) */
  sellerKey: string;
  /** Numeric seller ID */
  sellerId: number;
  /** Price per unit in cents */
  priceCents: number;
  /** Available quantity from this seller */
  quantity: number;
  /** Shipping cost in cents (buyer-facing, includes TCGPlayer markup) */
  shippingCents: number;
  /** Seller's own shipping cost in cents (may differ from shippingCents due to thresholds) */
  sellerShippingCents: number;
  /** Whether seller is verified/Gold Star */
  verified: boolean;
  /** Condition of the card */
  condition: string;
  /** Printing (Normal/Foil) */
  printing: string;
  channelId: number;
}

/** Summary data from the cart API */
export interface CartSummary {
  itemCount: number;
  sellerCount: number;
  cartCostCents: number;
  shippingCostCents: number;
}

/** Messages between content script, popup, and background */
export type ExtensionMessage =
  | { type: "READ_CART" }
  | { type: "CART_DATA"; items: CartItem[]; summary: CartSummary | null }
  | { type: "OPTIMIZATION_ERROR"; error: string }
  | { type: "UPDATE_CART_RESULT"; success: boolean; error?: string }
  | { type: "UPDATE_CART_PROGRESS"; stage: string; progress: number }
  | { type: "EXPORT_CLI_INPUT"; items: CartItem[]; verifiedOnly: boolean }
  | { type: "EXPORT_CLI_INPUT_PROGRESS"; stage: string; progress: number }
  | { type: "EXPORT_CLI_INPUT_RESULT"; data: CliOptimizerInput }
  | { type: "APPLY_CLI_OUTPUT"; items: CartItem[]; output: CliOptimizerOutput }
  | { type: "IMPORT_PRODUCTS"; productIds: number[] }
  | { type: "IMPORT_SKUS"; skus: number[] }
  | { type: "IMPORT_PRODUCTS_PROGRESS"; stage: string; progress: number }
