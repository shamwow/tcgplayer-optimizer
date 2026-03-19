// This script captures a snapshot of live TCGPlayer listings for a specific set of product IDs,
// simulating a "cart" with 72 cards. It also fetches seller shipping thresholds.
//
// The data is then used in tests (so that each run isn't stuck fetching data from the live API).
// Meant to speed up iteration on the optimizer.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API_BASE = "https://mp-search-api.tcgplayer.com/v1";
const MPAPI_BASE = "https://mpapi.tcgplayer.com/v2";
const PAGE_SIZE = 50;
const MAX_LISTINGS_PER_SORT = 100;
const FETCH_CONCURRENCY = 5;
const OUTPUT_PATH = resolve("test/fixtures/live-72-card-cart.json");

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: "https://www.tcgplayer.com",
  Referer: "https://www.tcgplayer.com/",
};

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

  // Step 1: Fetch listings with dual-sort strategy
  const listingsPerCard = new Array(productIds.length);
  let completed = 0;
  let active = 0;
  let nextIndex = 0;

  await new Promise((resolveRun, rejectRun) => {
    function launchNext() {
      while (active < FETCH_CONCURRENCY && nextIndex < productIds.length) {
        const index = nextIndex++;
        active++;
        fetchListingsDual(productIds[index])
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
  const allSellerIds = new Map(); // sellerKey → sellerId
  for (const listings of listingsPerCard) {
    for (const l of listings) {
      if (l.sellerId > 0 && !allSellerIds.has(l.sellerKey)) {
        allSellerIds.set(l.sellerKey, l.sellerId);
      }
    }
  }
  const uniqueSellers = allSellerIds.size;
  console.log(`[fixture] Fetched ${totalListings} listings from ${uniqueSellers} unique sellers`);

  // Step 2: Fetch seller shipping thresholds
  console.log(`[fixture] Fetching shipping thresholds for ${uniqueSellers} sellers...`);
  const sellerShipping = {};
  const sellerList = Array.from(allSellerIds.values()).map((sellerId) => ({
    sellerId,
    largestShippingCategoryId: 1,
  }));

  // Batch in groups of 100
  for (let i = 0; i < sellerList.length; i += 100) {
    const batch = sellerList.slice(i, i + 100);
    try {
      const res = await fetch(`${MPAPI_BASE}/seller/shippinginfo?countryCode=US`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        console.warn(`[fixture] Shipping info batch ${i}-${i + batch.length} failed: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const infos = data.results?.flat() ?? [];
      for (const info of infos) {
        const standard = info.sellerShippingOptions?.find(
          (opt) => opt.shippingMethodCode === "TCGFIRSTCLASS"
        );
        if (standard) {
          sellerShipping[info.sellerKey] = {
            shippingUnderCents: Math.round((standard.shippingPriceUnderThreshold ?? standard.price ?? 0) * 100),
            shippingOverCents: Math.round((standard.shippingPriceOverThreshold ?? standard.price ?? 0) * 100),
            thresholdCents: Math.round((standard.thresholdPrice ?? 0) * 100),
          };
        }
      }
      console.log(`[fixture] Shipping batch ${i}-${i + batch.length}: ${infos.length} responses`);
    } catch (err) {
      console.warn(`[fixture] Shipping info batch ${i} error:`, err.message);
    }
  }

  console.log(`[fixture] Got shipping thresholds for ${Object.keys(sellerShipping).length} sellers`);

  // Strip sellerId from listings for output (not needed by solver)
  const listingsForOutput = listingsPerCard.map((listings) =>
    listings.map(({ sellerId, ...rest }) => rest)
  );

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
      sellersWithThreshold: Object.values(sellerShipping).filter(
        (s) => s.shippingUnderCents > s.shippingOverCents
      ).length,
    },
    cards,
    listingsPerCard: listingsForOutput,
    sellerShipping,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  console.log(
    `[fixture] Wrote ${cards.length} cards, ${totalListings} listings, ${uniqueSellers} sellers, ${Object.keys(sellerShipping).length} shipping thresholds to ${OUTPUT_PATH}`
  );
}

async function fetchListingsSorted(productId, sortField) {
  const allListings = [];
  let from = 0;
  let totalResults = Infinity;

  while (from < totalResults && allListings.length < MAX_LISTINGS_PER_SORT) {
    const response = await fetch(`${API_BASE}/product/${productId}/listings`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(buildSearchRequest(from, PAGE_SIZE, sortField)),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to fetch product ${productId}: HTTP ${response.status} ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const resultSet = data.results?.[0];
    if (!resultSet) break;

    totalResults = resultSet.totalResults;
    const listings = resultSet.results
      .filter((l) => l.goldSeller && l.channelId !== 1)
      .map((l) => ({
        listingId: String(l.listingId),
        sellerKey: l.sellerKey,
        sellerId: parseInt(l.sellerId) || 0,
        priceCents: Math.round(l.price * 100),
        shippingCents: Math.round((l.shippingPrice ?? l.sellerShippingPrice ?? 0) * 100),
      }));

    allListings.push(...listings);
    from += PAGE_SIZE;
  }

  return allListings.slice(0, MAX_LISTINGS_PER_SORT);
}

async function fetchListingsDual(productId) {
  const byTotal = await fetchListingsSorted(productId, "price+shipping");
  const byPrice = await fetchListingsSorted(productId, "price");

  // Merge and deduplicate by sellerKey
  const seen = new Set();
  const merged = [];
  for (const l of [...byTotal, ...byPrice]) {
    if (!seen.has(l.sellerKey)) {
      seen.add(l.sellerKey);
      merged.push(l);
    }
  }
  return merged;
}

function buildSearchRequest(from, size, sortField = "price+shipping") {
  return {
    filters: {
      term: {
        condition: ["Near Mint"],
        printing: ["Normal"],
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

main().catch((error) => {
  console.error("[fixture] Capture failed:", error);
  process.exitCode = 1;
});
