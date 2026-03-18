import type { OptimizationResult } from "@/types";

export function ResultsTable({ result }: { result: OptimizationResult }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        Optimized Allocation
      </h2>
      <div
        style={{
          maxHeight: 250,
          overflowY: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr style={{ background: "#f9fafb", textAlign: "left" }}>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Card</th>
              <th style={{ padding: "6px 8px", fontWeight: 600 }}>Seller</th>
              <th style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}>
                Old
              </th>
              <th style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}>
                New
              </th>
            </tr>
          </thead>
          <tbody>
            {result.assignments.map((a) => (
              <tr
                key={a.cartIndex}
                style={{ borderTop: "1px solid #f3f4f6" }}
              >
                <td
                  style={{
                    padding: "5px 8px",
                    maxWidth: 130,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.name}
                </td>
                <td
                  style={{
                    padding: "5px 8px",
                    maxWidth: 100,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.listing.sellerName}
                </td>
                <td
                  style={{
                    padding: "5px 8px",
                    textAlign: "right",
                    color: "#6b7280",
                  }}
                >
                  ${(a.originalPriceCents / 100).toFixed(2)}
                </td>
                <td
                  style={{
                    padding: "5px 8px",
                    textAlign: "right",
                    fontWeight: 600,
                    color:
                      a.savingsCents > 0
                        ? "#16a34a"
                        : a.savingsCents < 0
                          ? "#dc2626"
                          : "#1a1a1a",
                  }}
                >
                  ${(a.listing.priceCents / 100).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
