import {
  assertNotAborted,
  batchSize,
  chunks,
  validateWinners,
  type BatchComparator,
  type ComparisonPair,
  type SortOptions,
  type SortResult,
  type SortStats,
} from "./shared.js";

export interface NetworkComparison {
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly ascending: boolean;
}
export type NetworkWave = readonly NetworkComparison[];
export interface BitonicSortStats extends SortStats {
  readonly algorithm: "bitonic";
  readonly paddedSize: number;
}

export function paddedSize(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("n must be a non-negative safe integer");
  let size = 1;
  while (size < Math.max(1, n)) size *= 2;
  return size;
}

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
        if (rightIndex > leftIndex) wave.push({ leftIndex, rightIndex, ascending: (leftIndex & block) === 0 });
      }
      waves.push(wave);
    }
  }
  return waves;
}

/** Sort using a fixed, predictably parallel bitonic network. */
export default async function bitonicSort<T>(
  input: readonly T[],
  compareBatch: BatchComparator<T>,
  options: SortOptions<T> = {},
): Promise<SortResult<T, BitonicSortStats>> {
  const inputSize = input.length;
  if (inputSize < 2) {
    return { items: [...input], stats: { algorithm: "bitonic", inputSize, paddedSize: paddedSize(inputSize), waves: 0, comparisons: 0, batchCalls: 0 } };
  }
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
        realPairs.push({ network: networkPair, pair: { id: `w${waveIndex}_p${pairIndex}`, left, right, leftIndex: networkPair.leftIndex, rightIndex: networkPair.rightIndex } });
      }
    }

    const batches = chunks(realPairs, batchSize(options.maxBatchSize, realPairs.length));
    const responses = await Promise.all(batches.map(async (batch, batchIndex) => {
      assertNotAborted(options.signal); batchCalls++;
      const pairs = batch.map(entry => entry.pair);
      const winners = await compareBatch(pairs, { wave: waveIndex, totalWaves: network.length, batch: batchIndex, totalBatches: batches.length, signal: options.signal });
      validateWinners(pairs, winners);
      return { batch, winners };
    }));
    for (const { batch, winners } of responses) for (const { network: pair, pair: semantic } of batch) {
      comparisons++;
      const earlier = winners[semantic.id] === "left" ? semantic.left : semantic.right;
      const later = winners[semantic.id] === "left" ? semantic.right : semantic.left;
      slots[pair.leftIndex] = pair.ascending ? earlier : later;
      slots[pair.rightIndex] = pair.ascending ? later : earlier;
    }
    for (const pair of wave) {
      const left = snapshot[pair.leftIndex]!;
      const right = snapshot[pair.rightIndex]!;
      if (left !== empty && right !== empty) continue;
      const real = left === empty ? right : left;
      slots[pair.leftIndex] = pair.ascending ? real : empty;
      slots[pair.rightIndex] = pair.ascending ? empty : real;
    }
    if (options.onWave) await options.onWave({ wave: waveIndex, totalWaves: network.length, comparisons: realPairs.length, items: slots.filter((item): item is T => item !== empty) });
  }
  return { items: slots.filter((item): item is T => item !== empty), stats: { algorithm: "bitonic", inputSize, paddedSize: size, waves: network.length, comparisons, batchCalls } };
}

export { bitonicSort };
