import { TypeSafeClient, choice, type JsonValue } from "@typesafe-ai/sdk";
import bitonicSortAlgorithm from "./bitonic.js";
import quickSortAlgorithm from "./quicksort.js";
import type { BitonicSortStats } from "./bitonic.js";
import type { QuickSortOptions, QuickSortStats } from "./quicksort.js";
import type { ComparisonPair, SortOptions, SortResult } from "./shared.js";

export interface JevClientOptions {
  /** TypeSafe API key. Defaults to the server-side TYPESAFE_API_KEY environment variable. */
  readonly apiKey?: string;
  readonly model?: string;
}

export interface JevSortOptions<T> extends QuickSortOptions<T> {
  /** Convert an item to JSON-safe state before sending it to Jev. */
  readonly serialize?: (item: T) => JsonValue;
  /** Override the standard pairwise decision instruction. */
  readonly instructions?: string;
}

export interface JevBitonicSortOptions<T> extends SortOptions<T> {
  readonly serialize?: (item: T) => JsonValue;
  readonly instructions?: string;
}

export interface JevClient {
  /** Sort with parallel quicksort, the default Jev Sort algorithm. */
  jevSort<T>(items: readonly T[], orderingRule: string, options?: JevSortOptions<T>): Promise<SortResult<T, QuickSortStats>>;
  /** Explicit alias for jevSort. */
  quickSort<T>(items: readonly T[], orderingRule: string, options?: JevSortOptions<T>): Promise<SortResult<T, QuickSortStats>>;
  /** Sort with the fixed bitonic network. */
  bitonicSort<T>(items: readonly T[], orderingRule: string, options?: JevBitonicSortOptions<T>): Promise<SortResult<T, BitonicSortStats>>;
}

const DEFAULT_INSTRUCTIONS = "Which item belongs earlier according to `ordering_rule`? Judge only this pair.";

/** Create a server-side Jev Sort client backed by TypeSafe's official SDK. */
export function createJevClient(options: JevClientOptions = {}): JevClient {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    defaultModel: options.model ?? "jev-latest",
  });

  function comparator<T>(orderingRule: string, serialize: (item: T) => JsonValue, instructions: string) {
    const rule = orderingRule.trim();
    if (!rule) throw new Error("orderingRule must not be empty");
    return async (pairs: readonly ComparisonPair<T>[], context: { signal?: AbortSignal }): Promise<Readonly<Record<string, "left" | "right">>> => {
      const questions = Object.fromEntries(pairs.map(pair => [
        pair.id,
        choice(instructions, {
          left: "Item A belongs earlier than Item B.",
          right: "Item B belongs earlier than Item A.",
        }),
      ]));
      const result = await client.systemOne({
        state: {
          ordering_rule: rule,
          pairs: Object.fromEntries(pairs.map(pair => [pair.id, {
            item_a: serialize(pair.left),
            item_b: serialize(pair.right),
          }])),
        },
        questions,
      }, { signal: context.signal });
      return Object.fromEntries(pairs.map(pair => {
        const selected = result.answers[pair.id]?.choice;
        if (selected !== "left" && selected !== "right") throw new Error(`TypeSafe returned an invalid choice for ${pair.id}`);
        return [pair.id, selected];
      }));
    };
  }

  const defaultSerialize = <T>(item: T): JsonValue => item as JsonValue;

  async function jevSort<T>(items: readonly T[], orderingRule: string, sortOptions: JevSortOptions<T> = {}) {
    const { serialize = defaultSerialize<T>, instructions = DEFAULT_INSTRUCTIONS, maxBatchSize = 255, ...algorithmOptions } = sortOptions;
    if (maxBatchSize > 255) throw new RangeError("TypeSafe Choice requests support at most 255 comparisons per batch");
    return quickSortAlgorithm(items, comparator(orderingRule, serialize, instructions), { ...algorithmOptions, maxBatchSize });
  }

  async function bitonicSort<T>(items: readonly T[], orderingRule: string, sortOptions: JevBitonicSortOptions<T> = {}) {
    const { serialize = defaultSerialize<T>, instructions = DEFAULT_INSTRUCTIONS, maxBatchSize = 255, ...algorithmOptions } = sortOptions;
    if (maxBatchSize > 255) throw new RangeError("TypeSafe Choice requests support at most 255 comparisons per batch");
    return bitonicSortAlgorithm(items, comparator(orderingRule, serialize, instructions), { ...algorithmOptions, maxBatchSize });
  }

  return { jevSort, quickSort: jevSort, bitonicSort };
}
