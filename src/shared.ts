export type PairWinner = "left" | "right";

/** One semantic comparison in the current parallel round. */
export interface ComparisonPair<T> {
  /** Stable within one sort, useful as a model question ID. */
  readonly id: string;
  readonly left: T;
  readonly right: T;
  readonly leftIndex: number;
  readonly rightIndex: number;
}

export interface CompareBatchContext {
  /** Zero-based parallel round index. */
  readonly wave: number;
  /** Known for fixed networks; undefined for adaptive algorithms. */
  readonly totalWaves?: number;
  /** Zero-based chunk index when maxBatchSize splits a round. */
  readonly batch: number;
  readonly totalBatches: number;
  readonly signal?: AbortSignal;
}

/** Return one winner for every pair ID. The winner belongs earlier. */
export type BatchComparator<T> = (
  pairs: readonly ComparisonPair<T>[],
  context: CompareBatchContext,
) => Promise<Readonly<Record<string, PairWinner>>>;

export interface WaveProgress<T> {
  readonly wave: number;
  readonly totalWaves?: number;
  readonly comparisons: number;
  readonly items: readonly T[];
}

export interface SortOptions<T> {
  /** Split a round into batches. Batches in that round run concurrently. */
  readonly maxBatchSize?: number;
  readonly signal?: AbortSignal;
  readonly onWave?: (progress: WaveProgress<T>) => void | Promise<void>;
}

export interface SortStats {
  readonly algorithm: "bitonic" | "quicksort";
  readonly inputSize: number;
  readonly waves: number;
  readonly comparisons: number;
  readonly batchCalls: number;
}

export interface SortResult<T, S extends SortStats = SortStats> {
  readonly items: T[];
  readonly stats: S;
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The sort was aborted", "AbortError");
}

export function batchSize(value: number | undefined, pairCount: number): number {
  const size = value ?? Number.POSITIVE_INFINITY;
  if (!(size > 0)) throw new RangeError("maxBatchSize must be greater than zero");
  return Number.isFinite(size) ? Math.floor(size) : Math.max(1, pairCount);
}

export function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

export function validateWinners<T>(
  pairs: readonly ComparisonPair<T>[],
  winners: Readonly<Record<string, PairWinner>>,
): void {
  for (const pair of pairs) {
    if (winners[pair.id] !== "left" && winners[pair.id] !== "right") {
      throw new Error(`Comparator must return \"left\" or \"right\" for ${pair.id}`);
    }
  }
}
