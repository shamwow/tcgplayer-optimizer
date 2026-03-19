# Architecture

Chrome extension (Manifest V3) + local Python CLI solver.

## Components

```
src/
├── api/          # TCGPlayer API client (listings, cart management, rate limiting)
├── background/   # Extension service worker — orchestrates API calls and cart mutations
├── cli/          # TypeScript types and parsing for the CLI solver's JSON interface
├── content/      # Content script — overlay UI injected on tcgplayer.com cart pages
├── popup/        # Extension popup — brief instructions shown from the toolbar icon
└── types/        # Shared TypeScript types (CartItem, SellerListing, ExtensionMessage)

scripts/          # CLI solver (Python/HiGHS) and supporting Node entrypoint
test/             # Unit and verification tests (vitest), e2e tests (Playwright)
```

## Data Flow

1. Content script reads the cart page DOM and sends `READ_CART` to the service worker.
2. Service worker calls TCGPlayer APIs (validate cart, product lookup, seller info) and returns `CartItem[]`.
3. User clicks Export. Service worker fetches all seller listings (rate-limited, concurrent) and seller shipping thresholds, builds `CliOptimizerInput` JSON.
4. User runs `npm run solve` locally. The Node entrypoint bootstraps a Python venv, installs `highspy`, and runs the LP solver.
5. The Python solver builds a mixed-integer program (item assignments + shipping thresholds) and solves it exactly with HiGHS. Outputs `CliOptimizerOutput` JSON.
6. User imports the result. Content script parses and validates it, builds a review table, then sends `APPLY_CLI_OUTPUT` to the service worker.
7. Service worker removes all current cart items, waits for inventory release, then adds the optimized selections.

## Message Passing

Content script and service worker communicate via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. All message types are defined in the `ExtensionMessage` union type in `src/types/`.

## Build

Vite + `@crxjs/vite-plugin` bundles the extension. The `@` path alias maps to `src/`. Output goes to `dist/`.

## Notes

- HiGHS wasm was tried but it ended up being resource constrained and would crash on relatively small cart sized.
- The TCGPlayer API has many gotchas and might break with future changes. Verify your integration by running/creating verification tests. You might need to get new product ids / skus and other fixture data as old one's become stale.
