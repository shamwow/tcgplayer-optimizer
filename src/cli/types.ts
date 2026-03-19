export const CLI_INPUT_FORMAT = "tcgplayer-optimizer-cli-input";
export const CLI_OUTPUT_FORMAT = "tcgplayer-optimizer-cli-output";
export const CLI_FORMAT_VERSION = 1;

export interface CliDesiredItem {
  cartIndex: number;
  sku: number;
  productId: number;
  name: string;
  condition: string;
  printing: string;
  currentPriceCents: number;
  currentSellerKey: string;
}

export interface CliSeller {
  sellerId: number;
  sellerKey: string;
  shippingUnderCents: number;
  shippingOverCents: number;
  thresholdCents: number;
}

export interface CliListing {
  sku: number;
  productId: number;
  listingId: string;
  sellerId: number;
  sellerKey: string;
  sellerName: string;
  priceCents: number;
  shippingCents: number;
  channelId: number;
  condition: string;
  printing: string;
}

export interface CliOptimizerInput {
  format: typeof CLI_INPUT_FORMAT;
  version: typeof CLI_FORMAT_VERSION;
  generatedAt: string;
  desiredItems: CliDesiredItem[];
  sellers: CliSeller[];
  listings: CliListing[];
}

export interface CliAssignment {
  cartIndex?: number;
  sku: number;
  sellerId: number;
  sellerKey?: string;
  sellerName?: string;
  listingId?: string;
  channelId?: number;
  priceCents?: number;
}

export interface CliOptimizerOutput {
  format: typeof CLI_OUTPUT_FORMAT;
  version: typeof CLI_FORMAT_VERSION;
  generatedAt: string;
  objectiveCents: number;
  itemCostCents: number;
  shippingCents: number;
  sellerCount: number;
  solveTimeMs: number;
  assignments: CliAssignment[];
}
