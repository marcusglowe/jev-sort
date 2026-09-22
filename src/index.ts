export type PairWinner = "left" | "right";

/** One semantic comparison in the current parallel network layer. */
export interface ComparisonPair<T> {
  /** Stable within one sort, useful as a question ID. */
  readonly id: string;
  readonly left: T;
  readonly right: T;
  readonly leftIndex: number;
  readonly rightIndex: number;
}

export interface CompareBatchContext {
  /** Zero-based parallel layer index. */
  readonly wave: number;
  readonly totalWaves: number;
  /** Zero-based chunk index when maxBatchSize splits a wave. */
  readonly batch: number;
  readonly totalBatches: number;
  readonly signal?: AbortSignal;
}

/** Return one winner for every pair ID. The winner is the item that belongs earlier. */
export type BatchComparator<T> = (
  pairs: readonly ComparisonPair<T>[],
  context: CompareBatchContext,
) => Promise<Readonly<Record<string, PairWinner>>>;

export interface NetworkComparison {
  readonly leftIndex: number;
  readonly rightIndex: number;
  /** Internal direction needed to construct the bitonic network. */
  readonly ascending: boolean;
}

export type NetworkWave = readonly NetworkComparison[];

export interface WaveProgress<T> {
  readonly wave: number;
  readonly totalWaves: number;
  readonly comparisons: number;
  readonly items: readonly T[];
}

export interface JevSortOptions<T> {
  /** Split a wave into batches. All batches in the same wave still run concurrently. */
  readonly maxBatchSize?: number;
  readonly signal?: AbortSignal;
  readonly onWave?: (progress: WaveProgress<T>) => void | Promise<void>;
}

export interface JevSortStats {
  readonly inputSize: number;
  readonly paddedSize: number;
  readonly waves: number;
  readonly comparisons: number;
  readonly batchCalls: number;
}

export interface JevSortResult<T> {
  readonly items: T[];
  readonly stats: JevSortStats;
}

/** Return the smallest power of two greater than or equal to n. */
export function paddedSize(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("n must be a non-negative safe integer");
  let size = 1;
  while (size < Math.max(1, n)) size *= 2;
  return size;
}

/** Build the fixed parallel layers of a bitonic sorting network. */
export function bitonicNetwork(size: number): NetworkWave[] {
  if (!Number.isSafeInteger(size) || size < 1 || (size & (size - 1)) !== 0) {
    throw new RangeError("size must be a positive power of two");
  }
  const waves: NetworkWave[] = [];
  for (let block = 2; block <= size; block *= 2) {
    for (let stride = block / 2; stride >= 1; stride = Math.floor(stride / 2)) {
      const wave: NetworkComparison[] = [];
      for (let leftIndex = 0; leftIndex < size; leftIndex++) {
        const rightIndex = leftIndex ^ stride;
        if (rightIndex > leftIndex) {
          wave.push({ leftIndex, rightIndex, ascending: (leftIndex & block) === 0 });
        }
      }
      waves.push(wave);
    }
  }
  return waves;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The sort was aborted", "AbortError");
}

/**
 * Sort items using a fixed bitonic network and a batched semantic comparator.
 *
 * The comparator decides only which item in each pair belongs earlier. This
 * function owns the network, padding, validation, and deterministic swaps.
 */
export async function jevSort<T>(
  input: readonly T[],
  compareBatch: BatchComparator<T>,
  options: JevSortOptions<T> = {},
): Promise<JevSortResult<T>> {
  const inputSize = input.length;
  if (inputSize < 2) {
    return { items: [...input], stats: { inputSize, paddedSize: paddedSize(inputSize), waves: 0, comparisons: 0, batchCalls: 0 } };
  }

  const maxBatchSize = options.maxBatchSize ?? Number.POSITIVE_INFINITY;
  if (!(maxBatchSize > 0)) throw new RangeError("maxBatchSize must be greater than zero");

  const size = paddedSize(inputSize);
  const empty = Symbol("jev-sort padding");
  type Slot = T | typeof empty;
  const slots: Slot[] = [...input, ...Array<Slot>(size - inputSize).fill(empty)];
  const network = bitonicNetwork(size);
  let comparisons = 0;
  let batchCalls = 0;

  for (let waveIndex = 0; waveIndex < network.length; waveIndex++) {
    assertNotAborted(options.signal);
    const wave = network[waveIndex]!;
    const snapshot = [...slots];
    const realPairs: Array<{ network: NetworkComparison; pair: ComparisonPair<T> }> = [];

    for (let pairIndex = 0; pairIndex < wave.length; pairIndex++) {
      const networkPair = wave[pairIndex]!;
      const left = snapshot[networkPair.leftIndex]!;
      const right = snapshot[networkPair.rightIndex]!;
      if (left !== empty && right !== empty) {
        realPairs.push({
          network: networkPair,
          pair: {
            id: `w${waveIndex}_p${pairIndex}`,
            left,
            right,
            leftIndex: networkPair.leftIndex,
            rightIndex: networkPair.rightIndex,
          },
        });
      }
    }

    const batchSize = Number.isFinite(maxBatchSize) ? Math.floor(maxBatchSize) : Math.max(1, realPairs.length);
    const batches = chunks(realPairs, batchSize);
    const responses = await Promise.all(batches.map(async (batch, batchIndex) => {
      assertNotAborted(options.signal);
      batchCalls++;
      return {
        batch,
        winners: await compareBatch(batch.map(entry => entry.pair), {
          wave: waveIndex,
          totalWaves: network.length,
          batch: batchIndex,
          totalBatches: batches.length,
          signal: options.signal,
        }),
      };
    }));

    for (const { batch, winners } of responses) {
      for (const { network: networkPair, pair } of batch) {
        const winner = winners[pair.id];
        if (winner !== "left" && winner !== "right") {
          throw new Error(`Comparator must return \"left\" or \"right\" for ${pair.id}`);
        }
        comparisons++;
        const earlier = winner === "left" ? pair.left : pair.right;
        const later = winner === "left" ? pair.right : pair.left;
        slots[networkPair.leftIndex] = networkPair.ascending ? earlier : later;
        slots[networkPair.rightIndex] = networkPair.ascending ? later : earlier;
      }
    }

    // Padding is always later than a real item and requires no model call.
    for (const networkPair of wave) {
      const left = snapshot[networkPair.leftIndex]!;
      const right = snapshot[networkPair.rightIndex]!;
      if (left !== empty && right !== empty) continue;
      const real = left === empty ? right : left;
      slots[networkPair.leftIndex] = networkPair.ascending ? real : empty;
      slots[networkPair.rightIndex] = networkPair.ascending ? empty : real;
    }

    if (options.onWave) {
      await options.onWave({
        wave: waveIndex,
        totalWaves: network.length,
        comparisons: realPairs.length,
        items: slots.filter((item): item is T => item !== empty),
      });
    }
  }

  return {
    items: slots.filter((item): item is T => item !== empty),
    stats: { inputSize, paddedSize: size, waves: network.length, comparisons, batchCalls },
  };
}
