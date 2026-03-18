import type { OptimizationResult } from "@/types";

export function SavingsBar({ result }: { result: OptimizationResult }) {
  const savingsPct =
    result.originalTotalCents > 0
      ? Math.round((result.savingsCents / result.originalTotalCents) * 100)
      : 0;

  return (
    <div
      style={{
        background: result.savingsCents > 0 ? "#f0fdf4" : "#fefce8",
        border: `1px solid ${result.savingsCents > 0 ? "#bbf7d0" : "#fef08a"}`,
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, color: "#16a34a" }}>
        {result.savingsCents > 0 ? "-" : ""}$
        {(Math.abs(result.savingsCents) / 100).toFixed(2)}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
        {result.savingsCents > 0
          ? `${savingsPct}% savings — $${(result.originalTotalCents / 100).toFixed(2)} → $${(result.totalCostCents / 100).toFixed(2)}`
          : "Cart is already optimally priced"}
      </div>
      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>
        Solved in {result.solveTimeMs}ms · {result.sellers.length} seller
        {result.sellers.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
