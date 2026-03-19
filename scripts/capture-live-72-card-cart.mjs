// This script is used to capture a snapshot of live TCGPlayer listings for a specific set of product IDs, 
// simulating a "cart" with 72 cards.
// 
// The data is then to be used in tests (so that each run isn't stuck fetching data from the live API)
//
// Meant to speed up iteration on the optimizer.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_BASE = "https://mp-search-api.tcgplayer.com/v1";
const PAGE_SIZE = 50;
const MAX_LISTINGS_PER_CARD = 200;
const FETCH_CONCURRENCY = 5;
const OUTPUT_PATH = resolve("test/fixtures/live-72-card-cart.json");

const productIds = [
  191577, 79991, 240223, 239783, 254197, 222169, 272617, 235949, 253134, 507303,
  108336, 591685, 222101, 15012, 495636, 533010, 251179, 105594, 13696, 634189,
  590836, 524983, 526197, 559751, 221932, 162901, 590441, 577156, 240145, 191041,
  457983, 553232, 498684, 616070, 79918, 577795, 581269, 609749, 36242, 196428,
  520020, 492676, 581991, 233772, 519220, 505368, 222102, 552327, 624916, 582778,
  642024, 5481, 206690, 517246, 240154, 235658, 238617, 128877, 162224, 199417,
  552794, 180808, 531115, 624158, 590828, 624156, 559505, 262058, 276478, 503372,
  609763, 559643,
];

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[fixture] Capturing ${productIds.length} products to ${OUTPUT_PATH}`);

  const cards = productIds.map((productId, cartIndex) => ({
    cartIndex,
    productId,
    name: `Product ${productId}`,
    currentPriceCents: 500,
  }));

  const listingsPerCard = new Array(productIds.length);
  let completed = 0;
  let active = 0;
  let nextIndex = 0;

  await new Promise((resolveRun, rejectRun) => {
    function launchNext() {
      while (active < FETCH_CONCURRENCY && nextIndex < productIds.length) {
        const index = nextIndex++;
        active++;
        fetchListings(productIds[index])
          .then((listings) => {
            listingsPerCard[index] = listings;
            completed++;
            console.log(
              `[fixture] ${completed}/${productIds.length} product ${productIds[index]} -> ${listings.length} listings`
            );
          })
          .catch(rejectRun)
          .finally(() => {
            active--;
            if (completed === productIds.length) {
              resolveRun();
              return;
            }
            launchNext();
          });
      }
    }

    launchNext();
  });

  const totalListings = listingsPerCard.reduce((sum, listings) => sum + listings.length, 0);
  const uniqueSellers = new Set(listingsPerCard.flatMap((listings) => listings.map((listing) => listing.sellerKey))).size;

  const fixture = {
    capturedAt: startedAt,
    source: {
      name: "tcgplayer-live-72-card-cart",
      condition: "Near Mint",
      printing: "Normal",
      productIds,
    },
    summary: {
      cardCount: cards.length,
      totalListings,
      uniqueSellers,
    },
    cards,
    listingsPerCard,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(
    `[fixture] Wrote ${cards.length} cards, ${totalListings} listings, ${uniqueSellers} sellers to ${OUTPUT_PATH}`
  );
}

async function fetchListings(productId) {
  const allListings = [];
  let from = 0;
  let totalResults = Infinity;

  while (from < totalResults && allListings.length < MAX_LISTINGS_PER_CARD) {
    const response = await fetch(`${API_BASE}/product/${productId}/listings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Origin: "https://www.tcgplayer.com",
        Referer: "https://www.tcgplayer.com/",
      },
      body: JSON.stringify(buildSearchRequest(from, PAGE_SIZE)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to fetch product ${productId}: HTTP ${response.status} ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const resultSet = data.results?.[0];
    if (!resultSet) {
      break;
    }

    totalResults = resultSet.totalResults;
    const listings = resultSet.results
      .filter((listing) => listing.goldSeller)
      .map((listing) => ({
        listingId: String(listing.listingId),
        sellerKey: listing.sellerKey,
        priceCents: Math.round(listing.price * 100),
        shippingCents: Math.round((listing.shippingPrice ?? listing.sellerShippingPrice ?? 0) * 100),
      }));

    allListings.push(...listings);
    from += PAGE_SIZE;
  }

  return allListings.slice(0, MAX_LISTINGS_PER_CARD);
}

function buildSearchRequest(from, size) {
  return {
    filters: {
      term: {
        condition: ["Near Mint"],
        printing: ["Normal"],
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

main().catch((error) => {
  console.error("[fixture] Capture failed:", error);
  process.exitCode = 1;
});
