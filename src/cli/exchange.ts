import type { CartItem } from "@/types";
import {
  CLI_FORMAT_VERSION,
  CLI_OUTPUT_FORMAT,
  type CliAssignment,
  type CliOptimizerOutput,
} from "./types";

export interface MatchedCliAssignment {
  item: CartItem;
  assignment: CliAssignment | null;
}

export function parseCliOptimizerOutput(raw: string): CliOptimizerOutput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CLI output must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("CLI output must be a JSON object.");
  }

  const output = parsed as Partial<CliOptimizerOutput>;
  if (output.format !== CLI_OUTPUT_FORMAT) {
    throw new Error(`CLI output must use format "${CLI_OUTPUT_FORMAT}".`);
  }
  if (output.version !== CLI_FORMAT_VERSION) {
    throw new Error(`CLI output version must be ${CLI_FORMAT_VERSION}.`);
  }
  if (!Array.isArray(output.assignments)) {
    throw new Error("CLI output must include an assignments array.");
  }

  for (const [index, assignment] of output.assignments.entries()) {
    if (!assignment || typeof assignment !== "object") {
      throw new Error(`Assignment ${index + 1} must be an object.`);
    }
    if (!isPositiveInteger(assignment.sku)) {
      throw new Error(`Assignment ${index + 1} is missing a valid sku.`);
    }
    if (!isNonNegativeInteger(assignment.sellerId)) {
      throw new Error(`Assignment ${index + 1} is missing a valid sellerId.`);
    }
    if (assignment.cartIndex !== undefined && !isNonNegativeInteger(assignment.cartIndex)) {
      throw new Error(`Assignment ${index + 1} has an invalid cartIndex.`);
    }
    if (assignment.channelId !== undefined && !isNonNegativeInteger(assignment.channelId)) {
      throw new Error(`Assignment ${index + 1} has an invalid channelId.`);
    }
  }

  return output as CliOptimizerOutput;
}

export function matchCliOutputToItems(
  items: CartItem[],
  output: CliOptimizerOutput
): MatchedCliAssignment[] {
  const itemsByCartIndex = new Map(items.map((item) => [item.cartIndex, item]));
  const matchedByCartIndex = new Map<number, CliAssignment>();
  const queuedBySku = new Map<number, CliAssignment[]>();
  const outputSkus = new Set<number>();

  for (const assignment of output.assignments) {
    outputSkus.add(assignment.sku);
    if (assignment.cartIndex !== undefined) {
      if (matchedByCartIndex.has(assignment.cartIndex)) {
        throw new Error(`CLI output includes duplicate assignments for cartIndex ${assignment.cartIndex}.`);
      }

      const item = itemsByCartIndex.get(assignment.cartIndex);
      if (!item) {
        throw new Error(`CLI output references unknown cartIndex ${assignment.cartIndex}.`);
      }
      if (item.sku !== assignment.sku) {
        throw new Error(
          `CLI output assignment for cartIndex ${assignment.cartIndex} expected sku ${item.sku}, received ${assignment.sku}.`
        );
      }

      matchedByCartIndex.set(assignment.cartIndex, assignment);
      continue;
    }

    const queue = queuedBySku.get(assignment.sku) ?? [];
    queue.push(assignment);
    queuedBySku.set(assignment.sku, queue);
  }

  const matches: MatchedCliAssignment[] = [];
  for (const item of items) {
    let assignment = matchedByCartIndex.get(item.cartIndex);
    if (!assignment) {
      const queue = queuedBySku.get(item.sku);
      if (!queue || queue.length === 0) {
        if (!outputSkus.has(item.sku)) {
          matches.push({ item, assignment: null });
          continue;
        }
        throw new Error(`CLI output is missing an assignment for sku ${item.sku}.`);
      }
      assignment = queue.shift()!;
    }

    matches.push({ item, assignment });
  }

  for (const [sku, queue] of queuedBySku) {
    if (queue.length > 0) {
      throw new Error(`CLI output includes ${queue.length} extra assignment(s) for sku ${sku}.`);
    }
  }

  return matches;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}
