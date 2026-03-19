export function Popup() {
  return (
    <div style={{ padding: 16, lineHeight: 1.5 }}>
      <h1
        style={{
          fontSize: 16,
          fontWeight: 700,
          marginBottom: 12,
          color: "#1a3a5c",
        }}
      >
        TCGPlayer Cart Optimizer
      </h1>

      <p style={{ marginBottom: 10, color: "#374151" }}>
        Cart solving now runs through the local CLI instead of inside the
        extension.
      </p>

      <p style={{ marginBottom: 10, color: "#374151" }}>
        Open a TCGPlayer cart page and use the overlay to export the cart,
        run the solver locally, then import the result back into the cart.
      </p>

      <div
        style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          padding: 12,
          color: "#1e3a8a",
          fontSize: 12,
        }}
      >
        Command: <code>npm run solve --input &lt;export.json&gt; --output &lt;result.json&gt;</code>
      </div>
    </div>
  );
}
