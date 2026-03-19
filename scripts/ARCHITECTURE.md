# scripts

CLI solver and supporting utilities. Run outside the browser via Node/Python.

## Files

- **optimal-cart-cli.py** — The core solver. Reads `CliOptimizerInput` JSON, validates it, builds a mixed-integer linear program, and solves it with HiGHS. The LP has three variable types: `x_i_j` (binary: assign item `i` to listing `j`), `y_s` (binary: seller `s` is used), `z_s` (binary: seller `s` exceeds their shipping threshold). The objective minimizes total item cost + shipping. Constraints ensure each item is assigned to exactly one listing, sellers are marked as used when they have assignments, and shipping thresholds trigger correctly. Outputs `CliOptimizerOutput` JSON with assignments and cost breakdown. 10-minute solve timeout.
- **optimal-cart-entrypoint.mjs** — Node.js bootstrap for `npm run solve`. Creates a `.venv` if missing, installs `highspy` if missing, then forwards CLI args to the Python script. Handles `--input`/`--output` flags and also supports positional args.
- **capture-live-72-card-cart.mjs** — Test fixture generator. Fetches live listings and seller shipping info for a hardcoded set of 72 product IDs from TCGPlayer's API and saves the result as a JSON fixture to avoid repeated live API calls in tests.

## Solver Model

The solver uses exact integer linear programming (not a greedy heuristic). For a typical cart of ~70 items with ~100 sellers each, HiGHS solves to proven optimality in under a second. The shipping threshold model captures the real-world behavior where sellers charge different shipping rates above/below a subtotal threshold.
