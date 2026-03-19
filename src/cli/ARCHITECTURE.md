# src/cli

TypeScript types and parsing logic for the CLI solver's JSON interface. This defines the data contract between the extension and the Python solver.

## Files

- **types.ts** — Defines the input and output JSON schemas. `CliOptimizerInput` contains `desiredItems` (what the user wants), `sellers` (with shipping thresholds), and `listings` (available seller offerings per SKU). `CliOptimizerOutput` contains `assignments` (which listing to buy for each item) and cost breakdown.
- **exchange.ts** — `parseCliOptimizerOutput()` validates raw JSON against the output schema (format, version, assignment fields). `matchCliOutputToItems()` matches solver assignments back to cart items — first by `cartIndex` (exact match), then queued by SKU for assignments without a `cartIndex`. Validates no duplicates or missing assignments.

## JSON Format Versioning

Both input and output include `format` (string identifier) and `version` (integer) fields. The parser rejects mismatches so the extension and solver stay in sync.
