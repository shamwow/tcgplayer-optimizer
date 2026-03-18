/** Input to the LP model builder */
export interface ModelInput {
  /** Cards the user wants to buy */
  cards: Array<{
    cartIndex: number;
    productId: number;
    name: string;
    currentPriceCents: number;
  }>;
  /** Listings per card (outer index matches cards array) */
  listingsPerCard: ListingForModel[][];
  /** Optimization mode (default: "cheapest") */
  mode?: "cheapest" | "fewest-packages";
}

/** A listing as consumed by the model builder */
export interface ListingForModel {
  /** Unique listing identifier */
  listingId: string;
  /** Seller key */
  sellerKey: string;
  /** Price in cents */
  priceCents: number;
  /** Shipping in cents (per-seller, not per-item) */
  shippingCents: number;
}

/** Raw solver output before mapping back to domain types */
export interface SolverResult {
  status: "Optimal" | "Infeasible" | "Error" | "Timeout";
  /** Objective value (total cost in cents) */
  objectiveValue: number;
  /** Which listing index was chosen for each card index */
  chosenListings: Map<number, string>;
  /** Which sellers are used */
  activeSellers: Set<string>;
  /** Solve time in ms */
  solveTimeMs: number;
  /** Error message if status is Error */
  errorMessage?: string;
}
