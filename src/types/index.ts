/** A card the user wants to buy, parsed from the cart DOM */
export interface CartItem {
  /** Unique identifier within this cart (index-based) */
  cartIndex: number;
  /** TCGPlayer product ID (extracted from product URL) */
  productId: number;
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
}

/** A listing from a seller for a specific product */
export interface SellerListing {
  /** TCGPlayer listing ID */
  listingId: string;
  /** Product ID this listing is for */
  productId: number;
  /** Seller name */
  sellerName: string;
  /** Seller key/ID */
  sellerKey: string;
  /** Price per unit in cents */
  priceCents: number;
  /** Available quantity from this seller */
  quantity: number;
  /** Shipping cost in cents for this seller */
  shippingCents: number;
  /** Whether seller is verified/Gold Star */
  verified: boolean;
  /** Condition of the card */
  condition: string;
  /** Printing (Normal/Foil) */
  printing: string;
}

/** Per-card assignment in the optimal solution */
export interface CardAssignment {
  cartIndex: number;
  productId: number;
  name: string;
  /** The listing chosen for this card */
  listing: SellerListing;
  /** Original price the user had in cart (cents) */
  originalPriceCents: number;
  /** Savings on this card (cents, positive = cheaper) */
  savingsCents: number;
}

/** Per-seller summary */
export interface SellerSummary {
  sellerName: string;
  sellerKey: string;
  items: CardAssignment[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}

/** Full optimization result */
export interface OptimizationResult {
  /** Per-card assignments */
  assignments: CardAssignment[];
  /** Per-seller summaries */
  sellers: SellerSummary[];
  /** Total optimized cost (cards + shipping) in cents */
  totalCostCents: number;
  /** Original cart total in cents */
  originalTotalCents: number;
  /** Total savings in cents */
  savingsCents: number;
  /** Solver wall time in milliseconds */
  solveTimeMs: number;
  /** Cards that were skipped (no listings found) */
  skippedCards: SkippedCard[];
}

/** A card that was skipped during optimization */
export interface SkippedCard {
  name: string;
  condition: string;
  printing: string;
  reason: string;
}

/** Summary data from the cart API */
export interface CartSummary {
  itemCount: number;
  sellerCount: number;
  cartCostCents: number;
  shippingCostCents: number;
}

/** Optimization mode: minimize cost or minimize number of sellers */
export type OptimizeMode = "cheapest" | "fewest-packages";

/** Messages between content script, popup, and background */
export type ExtensionMessage =
  | { type: "READ_CART" }
  | { type: "CART_DATA"; items: CartItem[]; summary: CartSummary | null }
  | { type: "OPTIMIZE"; items: CartItem[]; verifiedOnly: boolean; mode: OptimizeMode }
  | { type: "OPTIMIZATION_PROGRESS"; stage: string; progress: number; detail?: string }
  | { type: "OPTIMIZATION_RESULT"; result: OptimizationResult }
  | { type: "OPTIMIZATION_ERROR"; error: string };
