/** Request body for the TCGPlayer listings search API */
export interface ListingsSearchRequest {
  filters: {
    term: Record<string, string[]>;
    range: Record<string, unknown>;
    exclude: Record<string, unknown>;
  };
  from: number;
  size: number;
  sort: {
    field: string;
    order: "asc" | "desc";
  };
  context: {
    shippingCountry: string;
    cart: Record<string, unknown>;
  };
}

/** A single listing result from the TCGPlayer API */
export interface ApiListingResult {
  listingId: number;
  productId: number;
  sellerName: string;
  sellerKey: string;
  sellerId: string;
  price: number;
  sellerPrice: number;
  quantity: number;
  shippingPrice: number;
  sellerShippingPrice: number;
  condition: string;
  printing: string;
  goldSeller: boolean;
  verifiedSeller: boolean;
  directInventory: number;
  directSeller: boolean;
  directListing: boolean;
  channelId: number;
  sellerRating: number;
  sellerSales: string;
  language: string;
  listingType: string;
}

/** Inner result wrapper from the API */
export interface ListingsResultSet {
  totalResults: number;
  resultId: string;
  results: ApiListingResult[];
  aggregations: Record<string, unknown>;
}

/** Top-level API response wrapper */
export interface ListingsSearchResponse {
  errors: unknown[];
  results: ListingsResultSet[];
}
