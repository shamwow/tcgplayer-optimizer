import type { SellerListing } from "@/types";
import type {
  ListingsSearchRequest,
  ListingsSearchResponse,
} from "./types";
import { RateLimiter } from "./rate-limiter";
import { TtlCache } from "./cache";

const API_BASE = "https://mp-search-api.tcgplayer.com/v1";
const PAGE_SIZE = 50;
const MAX_LISTINGS_PER_SORT = 100;

const rateLimiter = new RateLimiter(5);

/** 5-minute cache for listings keyed by "productId:condition:printing" */
export const listingsCache = new TtlCache<SellerListing[]>(5 * 60 * 1000);

/**
 * Fetch verified seller listings using a specific sort, up to MAX_LISTINGS_PER_SORT.
 */
async function fetchListingsSorted(
  productId: number,
  condition: string,
  printing: string,
  sortField: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<SellerListing[]> {
  const allListings: SellerListing[] = [];
  let from = 0;
  let totalResults = Infinity;
  let page = 0;

  while (from < totalResults && allListings.length < MAX_LISTINGS_PER_SORT) {
    await rateLimiter.wait();

    const url = `${API_BASE}/product/${productId}/listings`;
    const body = buildSearchRequest(condition, printing, from, PAGE_SIZE, sortField);

    console.log(`[TCG API] POST ${url} (product=${productId}, sort="${sortField}", from=${from})`);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Origin: "https://www.tcgplayer.com",
          Referer: "https://www.tcgplayer.com/",
        },
        body: JSON.stringify(body),
        credentials: "include",
      });
    } catch (fetchErr) {
      console.error(`[TCG API] Fetch failed for product ${productId}:`, fetchErr);
      throw fetchErr;
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[TCG API] HTTP ${response.status} for product ${productId}: ${errorBody.slice(0, 200)}`);
      throw new Error(
        `Listings API error: ${response.status} ${response.statusText}`
      );
    }

    const data: ListingsSearchResponse = await response.json();
    const resultSet = data.results?.[0];
    if (!resultSet) {
      console.warn(`[TCG API] No resultSet for product ${productId}, page ${page}`);
      break;
    }

    totalResults = resultSet.totalResults;
    page++;

    const listings = resultSet.results
      // Filter out channelId=1 listings — the add-to-cart API accepts them with
      // HTTP 200 but they silently fail to appear in the cart.
      .filter((r) => r.goldSeller && r.channelId !== 1)
      .map((r) => mapApiListing(r, productId));

    allListings.push(...listings);
    from += PAGE_SIZE;

    console.log(`[TCG API] Product ${productId} [${sortField}] page ${page}: ${listings.length} gold listings (${allListings.length}/${totalResults} total)`);
    onProgress?.(Math.min(allListings.length, totalResults), totalResults);
  }

  return allListings.slice(0, MAX_LISTINGS_PER_SORT);
}

/**
 * Fetch all verified seller listings for a given product with
 * the specified condition and printing.
 *
 * Uses a dual-fetch strategy: 200 listings sorted by price+shipping (best total
 * cost) and 200 sorted by price only (catches low-price sellers with high
 * shipping who become cheap when consolidating multiple cards). Results are
 * merged and deduplicated by sellerKey.
 */
export async function fetchListings(
  productId: number,
  condition: string,
  printing: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<SellerListing[]> {
  const cacheKey = `${productId}:${condition}:${printing}`;
  const cached = listingsCache.get(cacheKey);
  if (cached) {
    console.log(`[TCG API] Cache hit for product ${productId} (${cached.length} listings)`);
    return cached;
  }

  // Fetch by price+shipping (best individual total cost)
  const byTotal = await fetchListingsSorted(productId, condition, printing, "price+shipping", onProgress);

  // Fetch by price only (catches sellers with low item price but high shipping,
  // who become cheap when the optimizer consolidates multiple cards to one seller)
  const byPrice = await fetchListingsSorted(productId, condition, printing, "price", onProgress);

  // Merge and deduplicate by sellerKey (keep the first occurrence)
  const seen = new Set<string>();
  const merged: SellerListing[] = [];
  for (const listing of [...byTotal, ...byPrice]) {
    if (!seen.has(listing.sellerKey)) {
      seen.add(listing.sellerKey);
      merged.push(listing);
    }
  }

  listingsCache.set(cacheKey, merged);
  console.log(`[TCG API] Product ${productId} done: ${merged.length} listings (${byTotal.length} by total + ${byPrice.length} by price, ${merged.length - byTotal.length} new from price sort, cached)`);
  return merged;
}

function buildSearchRequest(
  condition: string,
  printing: string,
  from: number,
  size: number,
  sortField: string = "price+shipping"
): ListingsSearchRequest {
  return {
    filters: {
      term: {
        condition: [mapCondition(condition)],
        printing: [mapPrinting(printing)],
        sellerStatus: ["Live"],
        language: ["English"],
      },
      range: {},
      exclude: {},
    },
    from,
    size,
    sort: {
      field: sortField,
      order: "asc",
    },
    context: {
      shippingCountry: "US",
      cart: {},
    },
  };
}

function mapApiListing(
  result: { listingId: number; sellerId: string; sellerName: string; sellerKey: string; price: number; quantity: number; shippingPrice: number; sellerShippingPrice: number; condition: string; printing: string; goldSeller: boolean; channelId: number },
  productId: number
): SellerListing {
  return {
    listingId: String(result.listingId),
    productId,
    sellerName: result.sellerName,
    sellerKey: result.sellerKey,
    sellerId: parseInt(result.sellerId) || 0,
    priceCents: Math.round(result.price * 100),
    quantity: result.quantity,
    shippingCents: Math.round(
      (result.shippingPrice ?? result.sellerShippingPrice ?? 0) * 100
    ),
    sellerShippingCents: Math.round(
      (result.sellerShippingPrice ?? result.shippingPrice ?? 0) * 100
    ),
    verified: result.goldSeller,
    condition: result.condition,
    printing: result.printing,
    channelId: result.channelId,
  };
}

export interface CheapestListing {
  sellerKey: string;
  /** Item price (without shipping) — use this when adding to cart */
  price: number;
  /** Total price (price + shipping) — use this for sorting/comparison */
  totalPrice: number;
  sku: number;
  printing: string;
  channelId: number;
}

/**
 * Fetch the cheapest verified listings for a product with a given condition and printing.
 * Returns multiple so callers can fall back to the next seller if one is unavailable.
 */
async function fetchCheapestListingsForPrinting(
  productId: number,
  condition: string,
  printing: string,
  count: number,
): Promise<CheapestListing[]> {
  await rateLimiter.wait();

  const url = `${API_BASE}/product/${productId}/listings`;
  const body = buildSearchRequest(condition, printing, 0, count);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Origin: "https://www.tcgplayer.com",
      Referer: "https://www.tcgplayer.com/",
    },
    body: JSON.stringify(body),
    credentials: "include",
  });

  if (!response.ok) return [];

  const data = await response.json();
  const results = data.results?.[0]?.results ?? [];
  return results
    // Filter out channelId=1 — these silently fail to appear in the cart.
    .filter((r: { goldSeller: boolean; productConditionId: number; channelId: number }) => r.goldSeller && r.productConditionId && r.channelId !== 1)
    .map((r: { sellerKey: string; price: number; productConditionId: number; shippingPrice: number; sellerShippingPrice: number; channelId: number }) => ({
      sellerKey: r.sellerKey,
      price: r.price,
      totalPrice: r.price + (r.shippingPrice ?? r.sellerShippingPrice ?? 0),
      sku: r.productConditionId,
      printing,
      channelId: r.channelId,
    }));
}

/**
 * Fetch the cheapest verified listings for a product across Normal and Foil printings.
 * Both are fetched and merged, sorted by total price (price + shipping).
 */
export async function fetchCheapestListings(
  productId: number,
  condition: string = "Near Mint",
  printings: string[] = ["Normal"],
  count: number = 10,
): Promise<CheapestListing[]> {
  const allListings: CheapestListing[] = [];

  for (const printing of printings) {
    const listings = await fetchCheapestListingsForPrinting(productId, condition, printing, count);
    allListings.push(...listings);
  }

  // Sort: prefer ch:0 over ch:1, then by total price
  allListings.sort((a, b) => {
    if (a.channelId !== b.channelId) return a.channelId - b.channelId;
    return a.totalPrice - b.totalPrice;
  });
  return allListings;
}

/**
 * Convenience wrapper: fetch the single cheapest listing.
 */
export async function fetchCheapestListing(
  productId: number,
  condition: string = "Near Mint",
  printing: string = "Normal"
): Promise<CheapestListing | null> {
  const listings = await fetchCheapestListings(productId, condition, [printing], 10);
  return listings[0] ?? null;
}


/** Normalize condition string to API expected values */
function mapCondition(condition: string): string {
  const map: Record<string, string> = {
    "near mint": "Near Mint",
    "lightly played": "Lightly Played",
    "moderately played": "Moderately Played",
    "heavily played": "Heavily Played",
    damaged: "Damaged",
  };
  return map[condition.toLowerCase()] ?? condition;
}

/** Normalize printing string to API expected values */
function mapPrinting(printing: string): string {
  const map: Record<string, string> = {
    normal: "Normal",
    foil: "Foil",
    "1st edition": "1st Edition",
    unlimited: "Unlimited",
  };
  return map[printing.toLowerCase()] ?? printing;
}
