# src/api

TCGPlayer API client layer. All HTTP requests to TCGPlayer originate here.

## Files

- **tcgplayer.ts** — Listings search API. Fetches verified seller listings for a product using a dual-sort strategy: first by `price+shipping` (best individual cost), then by `price` only (catches sellers with low item price but high shipping who become cheap when consolidating). Results are merged and deduplicated by `sellerKey`. Uses `RateLimiter` (5 req/sec) and `TtlCache` (5 min).
- **cart.ts** — Cart management APIs across three TCGPlayer base URLs (`mpapi`, `mpgateway`, `mp-search-api`). Handles cart key retrieval (cookie or user API), cart validation, item add/remove, product lookup by SKU, and seller shipping info. `fetchCartItems()` orchestrates the full cart read pipeline: validate → product lookup → seller name resolution. Add-to-cart retries up to 3 times and rejects `channelId=1` listings (they silently fail).
- **rate-limiter.ts** — Slot-based rate limiter. `wait()` atomically reserves the next available time slot and sleeps if needed. Safe for concurrent callers.
- **cache.ts** — Generic TTL cache. Lazy expiration on `get()`; `size` prunes expired entries.
- **types.ts** — Request/response types for the listings search API.

## Key Design Decisions

- **Dual-sort fetch**: The optimizer needs sellers that are cheap in bulk, not just per-item. The price-only sort surfaces sellers whose high per-item shipping gets amortized across multiple cards.
- **channelId=1 filtering**: These listings return HTTP 200 from the add-to-cart API but silently fail to appear in the cart. Filtered out at both the listings and cart layers.
- **Verified-only default**: Only gold-star sellers are returned from listing fetches to avoid quality issues.
