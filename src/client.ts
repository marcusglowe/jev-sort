import { TypeSafeClient } from "@typesafe-ai/sdk";
import bitonicSort, { type BitonicSortStats } from "./bitonic.js";
import quickSort, { type QuickSortOptions, type QuickSortStats } from "./quicksort.js";
import scoreSort, { type ScoreSortOptions, type ScoreSortStats, type ScoreValue } from "./score.js";
import type { BatchComparator, SortOptions, SortResult, SortStats } from "./shared.js";

const DEFAULT_CRITERIA = [
  "Exceptionally weak fit for the ordering rule.",
  "Clearly below-average fit for the ordering rule.",
  "Mixed or roughly average fit for the ordering rule.",
  "Clearly above-average fit for the ordering rule.",
  "Exceptional fit for the ordering rule.",
] as const;

export interface JevClientConfig {
  /** TypeSafe API key. Falls back to `TYPESAFE_API_KEY`. */
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface JevScoreOptions extends ScoreSortOptions {
  /** Ordered score anchors, weakest to strongest. Use concrete domain descriptions when possible. */
  readonly criteria?: readonly string[];
  /** Extra scoring guidance included with every item. */
  readonly guidance?: string;
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface JevSortOptions<T> extends SortOptions<T> {
  readonly state?: Readonly<Record<string, unknown>>;
}
export interface JevQuickSortOptions<T> extends QuickSortOptions<T> {
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface JevClient {
  /** Fast default: score every item independently, then sort scores descending. */
  jevSort<T>(items: readonly T[], orderingRule: string, options?: JevScoreOptions): Promise<SortResult<T, ScoreSortStats>>;
  scoreSort<T>(items: readonly T[], orderingRule: string, options?: JevScoreOptions): Promise<SortResult<T, ScoreSortStats>>;
  /** Legacy precision path: adaptive pairwise quicksort. */
  quickSort<T>(items: readonly T[], orderingRule: string, options?: JevQuickSortOptions<T>): Promise<SortResult<T, QuickSortStats>>;
  /** Legacy fixed-network pairwise path. */
  bitonicSort<T>(items: readonly T[], orderingRule: string, options?: JevSortOptions<T>): Promise<SortResult<T, BitonicSortStats>>;
}

function toSdkConfig(config: JevClientConfig): Record<string, unknown> {
  return {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.fetch ? { fetch: config.fetch } : {}),
    ...(config.headers ? { headers: config.headers } : {}),
  };
}

function pairQuestions<T>(pairs: readonly { id: string; left: T; right: T }[]): Record<string, unknown> {
  return Object.fromEntries(pairs.map(pair => [pair.id, {
    type: "choice",
    instructions: {
      question: "Which item should appear earlier under `ordering_rule`?",
      item_a: { value: pair.left },
      item_b: { value: pair.right },
    },
    choices: ["left", "right"],
  }]));
}

function scoreQuestions<T>(
  entries: readonly { id: string; item: T }[],
  orderingRule: string,
  criteria: readonly string[],
  guidance?: string,
): Record<string, unknown> {
  return Object.fromEntries(entries.map(entry => [entry.id, {
    type: "score",
    instructions: {
      question: "How strongly does `item` satisfy `ordering_rule`?",
      item: entry.item,
      ordering_rule: orderingRule,
      guidance: guidance ?? "Use relevant knowledge and the shared anchored scale. Judge this item independently.",
    },
    criteria,
  }]));
}

/** Create a TypeSafe-backed semantic sorter. */
export function createJevClient(config: JevClientConfig = {}): JevClient {
  const client = new TypeSafeClient(toSdkConfig(config) as never);
  const model = config.model ?? "jev-latest";

  async function compare<T>(
    pairs: readonly { id: string; left: T; right: T }[],
    orderingRule: string,
    state: Readonly<Record<string, unknown>> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Readonly<Record<string, "left" | "right">>> {
    const pairState = Object.fromEntries(pairs.map(pair => [pair.id, { item_a: pair.left, item_b: pair.right }]));
    const response = await client.systemOne({
      model,
      state: { ...(config.state ?? {}), ...(state ?? {}), ordering_rule: orderingRule, pairs: pairState },
      questions: pairQuestions(pairs),
    } as never, { signal } as never);
    const answers = response.answers as Record<string, { choice?: unknown }>;
    return Object.fromEntries(pairs.map(pair => {
      const choice = answers[pair.id]?.choice;
      if (choice !== "left" && choice !== "right") throw new Error(`TypeSafe returned an invalid choice for ${pair.id}`);
      return [pair.id, choice];
    }));
  }

  async function runScore<T>(items: readonly T[], orderingRule: string, options: JevScoreOptions = {}) {
    const criteria = options.criteria ?? DEFAULT_CRITERIA;
    if (criteria.length < 2) throw new RangeError("criteria must contain at least two ordered score anchors");
    return scoreSort(items, async (entries, context) => {
      const response = await client.systemOne({
        model,
        state: { ...(config.state ?? {}), ...(options.state ?? {}), ordering_rule: orderingRule },
        questions: scoreQuestions(entries, orderingRule, criteria, options.guidance),
      } as never, { signal: context.signal } as never);
      const answers = response.answers as Record<string, { type?: unknown; score?: unknown; confidence?: unknown }>;
      return Object.fromEntries(entries.map(entry => {
        const answer = answers[entry.id];
        if (!answer || !Number.isFinite(answer.score)) throw new Error(`TypeSafe returned an invalid score for ${entry.id}`);
        return [entry.id, { score: answer.score as number, ...(Number.isFinite(answer.confidence) ? { confidence: answer.confidence as number } : {}) } satisfies ScoreValue];
      }));
    }, options);
  }

  return {
    jevSort: runScore,
    scoreSort: runScore,
    quickSort<T>(items: readonly T[], orderingRule: string, options: JevQuickSortOptions<T> = {}) {
      const comparator: BatchComparator<T> = (pairs, context) => compare(pairs, orderingRule, options.state, context.signal);
      return quickSort(items, comparator, options);
    },
    bitonicSort<T>(items: readonly T[], orderingRule: string, options: JevSortOptions<T> = {}) {
      const comparator: BatchComparator<T> = (pairs, context) => compare(pairs, orderingRule, options.state, context.signal);
      return bitonicSort(items, comparator, options);
    },
  };
}

/** One-shot fast semantic sort using TypeSafe Jev Score. */
export async function jevSort<T>(
  items: readonly T[],
  orderingRule: string,
  options: JevScoreOptions & JevClientConfig = {},
): Promise<SortResult<T, SortStats>> {
  const { apiKey, model, baseUrl, fetch, headers, state: clientState, ...sortOptions } = options;
  return createJevClient({ apiKey, model, baseUrl, fetch, headers, state: clientState }).jevSort(items, orderingRule, sortOptions);
}
