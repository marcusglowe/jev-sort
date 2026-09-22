import { assertNotAborted, batchSize, chunks, type SortResult, type SortStats } from "./shared.js";

export interface ScoreEntry<T> {
  readonly id: string;
  readonly item: T;
  readonly index: number;
}

export interface ScoreValue {
  readonly score: number;
  readonly confidence?: number;
}

export type BatchScorer<T> = (
  entries: readonly ScoreEntry<T>[],
  context: {
    readonly batch: number;
    readonly totalBatches: number;
    readonly signal?: AbortSignal;
  },
) => Promise<Readonly<Record<string, ScoreValue>>>;

export interface ScoreSortOptions {
  /** Items per scoring request. 350 was the fastest safe size in the reference benchmark. */
  readonly maxBatchSize?: number;
  /** Maximum scoring requests in flight. Defaults to 4. */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

export interface ScoreSortStats extends SortStats {
  readonly algorithm: "score";
  readonly judgments: number;
  readonly concurrency: number;
}

/**
 * Rank items from independent absolute scores, highest first.
 *
 * Scoring is O(n) AI work. Equal scores retain their input order.
 */
export default async function scoreSort<T>(
  input: readonly T[],
  scoreBatch: BatchScorer<T>,
  options: ScoreSortOptions = {},
): Promise<SortResult<T, ScoreSortStats>> {
  const inputSize = input.length;
  if (inputSize === 0) {
    return { items: [], stats: { algorithm: "score", inputSize, judgments: 0, concurrency: 0, waves: 0, comparisons: 0, batchCalls: 0 } };
  }
  assertNotAborted(options.signal);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive safe integer");
  const entries = input.map((item, index) => ({ id: `i${index}`, item, index }));
  const groups = chunks(entries, batchSize(options.maxBatchSize ?? 350, entries.length));
  const scored = new Map<string, ScoreValue>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const batch = cursor++;
      if (batch >= groups.length) return;
      assertNotAborted(options.signal);
      const group = groups[batch]!;
      const answers = await scoreBatch(group, { batch, totalBatches: groups.length, signal: options.signal });
      for (const entry of group) {
        const answer = answers[entry.id];
        if (!answer || !Number.isFinite(answer.score)) throw new Error(`scoreBatch returned an invalid score for ${entry.id}`);
        if (answer.confidence !== undefined && !Number.isFinite(answer.confidence)) throw new Error(`scoreBatch returned an invalid confidence for ${entry.id}`);
        scored.set(entry.id, answer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, worker));
  const ordered = [...entries].sort((left, right) => {
    const a = scored.get(left.id)!;
    const b = scored.get(right.id)!;
    return b.score - a.score || (b.confidence ?? 0) - (a.confidence ?? 0) || left.index - right.index;
  });
  return {
    items: ordered.map(entry => entry.item),
    stats: { algorithm: "score", inputSize, judgments: inputSize, concurrency: Math.min(concurrency, groups.length), waves: groups.length, comparisons: 0, batchCalls: groups.length },
  };
}

export { scoreSort };
