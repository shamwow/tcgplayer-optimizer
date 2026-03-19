# src/types

Shared TypeScript type definitions used across the extension.

## File

- **index.ts** — Defines:
  - `CartItem` — A card in the user's cart (product ID, SKU, name, condition, printing, price, seller).
  - `SellerListing` — A seller's offering for a product (price, shipping, quantity, verified status, channel ID).
  - `CartSummary` — Aggregate cart totals (item count, seller count, cost, shipping).
  - `ExtensionMessage` — Discriminated union of all message types passed between content script, popup, and service worker via Chrome's messaging API.
