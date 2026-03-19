# src/background

Chrome extension service worker. Runs in the extension's background context with cross-origin fetch privileges.

## File

- **service-worker.ts** — Listens for `chrome.runtime.onMessage` and dispatches to handler functions based on message type. Also handles extension icon clicks (toggles overlay or navigates to cart).

## Message Handlers

| Message Type | Handler | What it does |
|---|---|---|
| `READ_CART` | `handleReadCart` | Gets cart key (cookie → user API fallback), fetches cart items + summary |
| `EXPORT_CLI_INPUT` | `handleExportCliInput` | Fetches listings for all items (concurrent, max 5 parallel), fetches seller shipping thresholds, builds `CliOptimizerInput` |
| `APPLY_CLI_OUTPUT` | `handleApplyCliOutput` | Matches solver assignments to cart items, resolves missing seller details via listings lookup, clears cart, waits 5s, adds new selections |
| `IMPORT_PRODUCTS` | `handleImportProducts` | For each product ID, fetches cheapest listings and tries sellers in order until one succeeds |
| `IMPORT_SKUS` | `handleImportSkus` | Same as above but starts from SKU IDs, looks up product details first |

## Progress Reporting

Long-running operations send progress updates (`EXPORT_CLI_INPUT_PROGRESS`, `UPDATE_CART_PROGRESS`, `IMPORT_PRODUCTS_PROGRESS`) to all open TCGPlayer tabs and the popup via `chrome.tabs.sendMessage`.

## Key Design Decisions

- **Service worker handles all API calls**: Content scripts can't make cross-origin requests to TCGPlayer's API domains. The service worker runs with `host_permissions` and `credentials: "include"`.
- **5s pause between remove and add**: After clearing the cart, TCGPlayer needs time to release seller inventory back to the pool before re-adding items from potentially the same sellers.
- **Concurrent fetch with cap**: Listing fetches run in parallel but are capped at 5 concurrent to avoid overwhelming the API (on top of the rate limiter in the API layer).
