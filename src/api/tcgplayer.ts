import type { SellerListing } from "@/types";
import type {
  ListingsSearchRequest,
  ListingsSearchResponse,
} from "./types";
import { RateLimiter } from "./rate-limiter";
import { TtlCache } from "./cache";

const API_BASE = "https://mp-search-api.tcgplayer.com/v1";
const PAGE_SIZE = 50;
const MAX_LISTINGS_PER_CARD = 200;

const rateLimiter = new RateLimiter(5);

/** 5-minute cache for listings keyed by "productId:condition:printing" */
export const listingsCache = new TtlCache<SellerListing[]>(5 * 60 * 1000);

/**
 * Fetch all verified seller listings for a given product with
 * the specified condition and printing.
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

  const allListings: SellerListing[] = [];
  let from = 0;
  let totalResults = Infinity;
  let page = 0;

  while (from < totalResults && allListings.length < MAX_LISTINGS_PER_CARD) {
    await rateLimiter.wait();

    const url = `${API_BASE}/product/${productId}/listings`;
    const body = buildSearchRequest(condition, printing, from, PAGE_SIZE);

    console.log(`[TCG API] POST ${url} (product=${productId}, condition="${condition}", printing="${printing}", from=${from})`);

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
      .filter((r) => r.goldSeller)
      .map((r) => mapApiListing(r, productId));

    allListings.push(...listings);
    from += PAGE_SIZE;

    console.log(`[TCG API] Product ${productId} page ${page}: ${listings.length} gold listings (${allListings.length}/${totalResults} total)`);
    onProgress?.(Math.min(allListings.length, totalResults), totalResults);
  }

  const result = allListings.slice(0, MAX_LISTINGS_PER_CARD);
  listingsCache.set(cacheKey, result);
  console.log(`[TCG API] Product ${productId} done: ${result.length} listings (cached)`);
  return result;
}

function buildSearchRequest(
  condition: string,
  printing: string,
  from: number,
  size: number
): ListingsSearchRequest {
  return {
    filters: {
      term: {
        condition: [mapCondition(condition)],
        printing: [mapPrinting(printing)],
        sellerStatus: ["Live"],
      },
      range: {},
      exclude: {},
    },
    from,
    size,
    sort: {
      field: "price+shipping",
      order: "asc",
    },
    context: {
      shippingCountry: "US",
      cart: {},
    },
  };
}

function mapApiListing(
  result: { listingId: number; sellerName: string; sellerKey: string; price: number; quantity: number; shippingPrice: number; sellerShippingPrice: number; condition: string; printing: string; goldSeller: boolean },
  productId: number
): SellerListing {
  return {
    listingId: String(result.listingId),
    productId,
    sellerName: result.sellerName,
    sellerKey: result.sellerKey,
    priceCents: Math.round(result.price * 100),
    quantity: result.quantity,
    shippingCents: Math.round(
      (result.shippingPrice ?? result.sellerShippingPrice ?? 0) * 100
    ),
    verified: result.goldSeller,
    condition: result.condition,
    printing: result.printing,
  };
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
