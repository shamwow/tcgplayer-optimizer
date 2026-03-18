import { useState } from "react";
import type { OptimizationResult } from "@/types";
import { formatOptimizedListForMassEntry } from "@/content/cart-modifier";

export function ApplyButton({ result }: { result: OptimizationResult }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = formatOptimizedListForMassEntry(result);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        width: "100%",
        padding: "10px 16px",
        background: copied ? "#16a34a" : "#1a3a5c",
        color: "white",
        border: "none",
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {copied ? "Copied to Clipboard!" : "Copy Optimized List"}
    </button>
  );
}
