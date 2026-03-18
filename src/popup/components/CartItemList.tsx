import type { CartItem } from "@/types";

export function CartItemList({ items }: { items: CartItem[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        Cart Items ({items.length})
      </h2>
      <div
        style={{
          maxHeight: 200,
          overflowY: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
        }}
      >
        {items.map((item) => (
          <div
            key={item.cartIndex}
            style={{
              padding: "6px 10px",
              borderBottom: "1px solid #f3f4f6",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{item.name}</div>
              <div style={{ color: "#6b7280", fontSize: 11 }}>
                {item.condition} · {item.printing} · {item.setName}
              </div>
            </div>
            <div style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
              ${(item.currentPriceCents / 100).toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
