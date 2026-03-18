import { useState, useEffect, useCallback } from "react";
import type {
  CartItem,
  OptimizationResult,
  ExtensionMessage,
} from "@/types";
import { CartItemList } from "./components/CartItemList";
import { OptimizeButton } from "./components/OptimizeButton";
import { ProgressBar } from "./components/ProgressBar";
import { ResultsTable } from "./components/ResultsTable";
import { SellerSummary } from "./components/SellerSummary";
import { SavingsBar } from "./components/SavingsBar";
import { ApplyButton } from "./components/ApplyButton";

type Stage = "idle" | "reading" | "optimizing" | "done" | "error";

export function Popup() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState({ stage: "", progress: 0 });
  const [error, setError] = useState<string | null>(null);

  // Read cart when popup opens
  useEffect(() => {
    readCart();
  }, []);

  // Listen for progress updates from background
  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === "OPTIMIZATION_PROGRESS") {
        setProgress({ stage: message.stage, progress: message.progress });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const readCart = useCallback(async () => {
    setStage("reading");
    setError(null);
    try {
      // Read cart via background worker (uses TCGPlayer API, not DOM)
      const response: ExtensionMessage = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "READ_CART" } satisfies ExtensionMessage,
          resolve
        );
      });

      if (response?.type === "CART_DATA") {
        setItems(response.items);
        setStage("idle");
      } else if (response?.type === "OPTIMIZATION_ERROR") {
        setError(response.error);
        setStage("error");
      } else {
        setError("Could not read cart. Are you logged in to TCGPlayer?");
        setStage("error");
      }
    } catch {
      setError("Could not read cart. Please try again.");
      setStage("error");
    }
  }, []);

  const optimize = useCallback(async () => {
    if (items.length === 0) return;
    setStage("optimizing");
    setError(null);
    setProgress({ stage: "Starting...", progress: 0 });

    try {
      const response: ExtensionMessage = await new Promise(
        (resolve) => {
          chrome.runtime.sendMessage(
            { type: "OPTIMIZE", items } satisfies ExtensionMessage,
            resolve
          );
        }
      );

      if (response.type === "OPTIMIZATION_RESULT") {
        setResult(response.result);
        setStage("done");
      } else if (response.type === "OPTIMIZATION_ERROR") {
        setError(response.error);
        setStage("error");
      }
    } catch {
      setError("Optimization failed unexpectedly.");
      setStage("error");
    }
  }, [items]);

  return (
    <div style={{ padding: 16 }}>
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

      {error && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            padding: 10,
            marginBottom: 12,
            color: "#dc2626",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {stage === "reading" && (
        <p style={{ color: "#666", fontSize: 12 }}>Reading cart...</p>
      )}

      {items.length > 0 && stage !== "done" && (
        <>
          <CartItemList items={items} />
          <OptimizeButton
            onClick={optimize}
            disabled={stage === "optimizing"}
            itemCount={items.length}
          />
        </>
      )}

      {stage === "optimizing" && (
        <ProgressBar stage={progress.stage} progress={progress.progress} />
      )}

      {stage === "done" && result && (
        <>
          <SavingsBar result={result} />
          <ResultsTable result={result} />
          <SellerSummary result={result} />
          <ApplyButton result={result} />
        </>
      )}

      {items.length === 0 && stage === "idle" && (
        <p style={{ color: "#666", fontSize: 12, textAlign: "center" }}>
          Your cart is empty or you're not logged in to TCGPlayer.
          Add items to your cart and try again.
        </p>
      )}
    </div>
  );
}
