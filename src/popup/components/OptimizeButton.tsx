interface Props {
  onClick: () => void;
  disabled: boolean;
  itemCount: number;
}

export function OptimizeButton({ onClick, disabled, itemCount }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "10px 16px",
        background: disabled ? "#9ca3af" : "#2563eb",
        color: "white",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        marginBottom: 12,
      }}
    >
      {disabled ? "Optimizing..." : `Optimize ${itemCount} Items`}
    </button>
  );
}
