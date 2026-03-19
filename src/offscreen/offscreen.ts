import { solve } from "@/optimizer/solver";
import type { ModelInput } from "@/optimizer/types";

/**
 * Offscreen document that runs the HiGHS WASM solver.
 * Service workers can't use `window`, but offscreen documents can.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SOLVE") {
    const raw = message.input;
    // Deserialize sellerShipping from array of entries back to Map
    const input: ModelInput = {
      ...raw,
      sellerShipping: raw.sellerShipping
        ? new Map(raw.sellerShipping)
        : undefined,
    };
    console.log("[TCG Solver Offscreen] Solving model...");
    solve(input)
      .then((result) => {
        console.log(`[TCG Solver Offscreen] Result: ${result.status} in ${result.solveTimeMs}ms`);
        // SolverResult has Maps/Sets which can't be sent via message passing
        // Convert to plain objects
        sendResponse({
          status: result.status,
          objectiveValue: result.objectiveValue,
          chosenListings: Array.from(result.chosenListings.entries()),
          activeSellers: Array.from(result.activeSellers),
          solveTimeMs: result.solveTimeMs,
          errorMessage: result.errorMessage,
        });
      })
      .catch((err) => {
        console.error("[TCG Solver Offscreen] Error:", err);
        sendResponse({
          status: "Error",
          objectiveValue: 0,
          chosenListings: [],
          activeSellers: [],
          solveTimeMs: 0,
          errorMessage: err instanceof Error ? err.message : "Solver failed",
        });
      });
    return true; // async response
  }
});

console.log("[TCG Solver Offscreen] Ready");
