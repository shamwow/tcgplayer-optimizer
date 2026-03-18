import type { OptimizationResult } from "@/types";

export function SellerSummary({ result }: { result: OptimizationResult }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        Seller Breakdown ({result.sellers.length} sellers)
      </h2>
      <div
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        {result.sellers.map((seller) => (
          <div
            key={seller.sellerKey}
            style={{
              padding: "8px 10px",
              borderBottom: "1px solid #f3f4f6",
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 600,
                marginBottom: 2,
              }}
            >
              <span>{seller.sellerName}</span>
              <span>${(seller.totalCents / 100).toFixed(2)}</span>
            </div>
            <div style={{ color: "#6b7280", fontSize: 11 }}>
              {seller.items.length} item{seller.items.length !== 1 ? "s" : ""}{" "}
              · Cards: ${(seller.subtotalCents / 100).toFixed(2)} · Shipping: $
              {(seller.shippingCents / 100).toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
