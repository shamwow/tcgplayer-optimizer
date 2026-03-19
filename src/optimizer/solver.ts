import type { ModelInput, SolverResult } from "./types";
import { buildLpModel, buildVariableMap } from "./model";

// highs-js types
interface HighsSolution {
  Status: string;
  ObjectiveValue: number;
  Columns: Record<
    string,
    { Index: number; Status: string; Lower: number; Upper: number; Primal: number; Dual: number; Type: string; Name: string }
  >;
}

interface HighsModule {
  solve(lp: string): HighsSolution;
}

let highsInstance: HighsModule | null = null;

/**
 * Load the HiGHS WASM solver. Caches the instance for reuse.
 */
async function getHighs(): Promise<HighsModule> {
  if (highsInstance) return highsInstance;

  // Dynamic import of highs-js
  const highs = await import("highs");
  const loader = highs.default as unknown as (opts?: { locateFile?: (file: string) => string }) => Promise<HighsModule>;

  // In extension context, the WASM file is at the extension root
  // chrome.runtime.getURL resolves it to the extension's internal URL
  const locateFile = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? (file: string) => chrome.runtime.getURL(file)
    : undefined;

  highsInstance = await loader(locateFile ? { locateFile } : undefined);
  return highsInstance;
}

/**
 * Solve the cart optimization ILP and return the result.
 */
export async function solve(input: ModelInput): Promise<SolverResult> {
  const startTime = performance.now();

  // Pre-solve: filter out cards with no listings (they'll be reported as skipped)
  const filteredCards = [];
  const filteredListings = [];
  for (let i = 0; i < input.cards.length; i++) {
    if (input.listingsPerCard[i].length > 0) {
      filteredCards.push(input.cards[i]);
      filteredListings.push(input.listingsPerCard[i]);
    }
  }

  if (filteredCards.length === 0) {
    return {
      status: "Infeasible",
      objectiveValue: 0,
      chosenListings: new Map(),
      activeSellers: new Set(),
      solveTimeMs: Math.round(performance.now() - startTime),
      errorMessage: "No listings found for any cards in the cart.",
    };
  }

  // For fewest-packages mode, limit listings per card to keep the LP model
  // small enough for the WASM solver. We keep the cheapest listings per card
  // (sorted by price + shipping) since that's sufficient for finding good
  // seller consolidation while keeping the model tractable.
  const MAX_LISTINGS_FEWEST = 30;
  if (input.mode === "fewest-packages") {
    for (let i = 0; i < filteredListings.length; i++) {
      if (filteredListings[i].length > MAX_LISTINGS_FEWEST) {
        // Sort by total cost (price + shipping) and keep cheapest
        filteredListings[i] = [...filteredListings[i]]
          .sort((a, b) => (a.priceCents + a.shippingCents) - (b.priceCents + b.shippingCents))
          .slice(0, MAX_LISTINGS_FEWEST);
      }
    }
  }

  const filteredInput: ModelInput = {
    cards: filteredCards,
    listingsPerCard: filteredListings,
    mode: input.mode,
  };

  // Build the LP model
  const lpString = buildLpModel(filteredInput);
  const variableMap = buildVariableMap(filteredInput);
  const totalListings = filteredListings.reduce((s, l) => s + l.length, 0);
  console.log(`[Solver] LP model: ${filteredCards.length} cards, ${totalListings} listings, ${lpString.length} chars, mode=${input.mode ?? "cheapest"}`);

  try {
    const highs = await getHighs();
    const solution = highs.solve(lpString);
    const solveTimeMs = Math.round(performance.now() - startTime);

    if (solution.Status === "Optimal") {
      const chosenListings = new Map<number, string>();
      const activeSellers = new Set<string>();

      for (const [varName, col] of Object.entries(solution.Columns)) {
        // Check if this variable is set to 1 (binary)
        if (col.Primal > 0.5) {
          const mapping = variableMap.get(varName);
          if (mapping) {
            chosenListings.set(mapping.cardIndex, mapping.listingId);
          }
          // Track active sellers
          if (varName.startsWith("y_")) {
            activeSellers.add(varName.slice(2));
          }
        }
      }

      return {
        status: "Optimal",
        objectiveValue: Math.round(solution.ObjectiveValue),
        chosenListings,
        activeSellers,
        solveTimeMs,
      };
    }

    if (solution.Status === "Infeasible") {
      return {
        status: "Infeasible",
        objectiveValue: 0,
        chosenListings: new Map(),
        activeSellers: new Set(),
        solveTimeMs,
        errorMessage:
          "No feasible solution found. Some cards may have no available listings.",
      };
    }

    return {
      status: "Error",
      objectiveValue: 0,
      chosenListings: new Map(),
      activeSellers: new Set(),
      solveTimeMs,
      errorMessage: `Solver returned status: ${solution.Status}`,
    };
  } catch (err) {
    const solveTimeMs = Math.round(performance.now() - startTime);
    return {
      status: "Error",
      objectiveValue: 0,
      chosenListings: new Map(),
      activeSellers: new Set(),
      solveTimeMs,
      errorMessage: err instanceof Error ? err.message : "Solver failed",
    };
  }
}

/** Expose for testing */
export { buildLpModel, buildVariableMap };
