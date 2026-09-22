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

export interface QuickSortStats extends SortStats {
  readonly algorithm: "quicksort";
}
export interface QuickSortOptions<T> extends SortOptions<T> {
  /** Choose the pivot index for a partition. Defaults to its middle item. */
  readonly choosePivot?: (partition: readonly T[], wave: number) => number;
}
interface Partition<T> { readonly key: number; readonly items: T[] }

/** Sort with adaptive parallel quicksort: every active partition advances together. */
export default async function quickSort<T>(
  input: readonly T[],
  compareBatch: BatchComparator<T>,
  options: QuickSortOptions<T> = {},
): Promise<SortResult<T, QuickSortStats>> {
  const inputSize = input.length;
  if (inputSize < 2) return { items: [...input], stats: { algorithm: "quicksort", inputSize, waves: 0, comparisons: 0, batchCalls: 0 } };
  let partitions: Partition<T>[] = [{ key: 0, items: [...input] }];
  let wave = 0;
  let comparisons = 0;
  let batchCalls = 0;

  while (partitions.some(partition => partition.items.length > 1)) {
    assertNotAborted(options.signal);
    const active = partitions.filter(partition => partition.items.length > 1);
    const specs = new Map<number, { pivot: T; before: T[]; after: T[]; pairs: ComparisonPair<T>[] }>();
    const allPairs: ComparisonPair<T>[] = [];
    for (const partition of active) {
      const proposed = options.choosePivot?.(partition.items, wave) ?? Math.floor(partition.items.length / 2);
      if (!Number.isInteger(proposed) || proposed < 0 || proposed >= partition.items.length) throw new RangeError("choosePivot must return a valid partition index");
      const pivot = partition.items[proposed]!;
      const spec = { pivot, before: [] as T[], after: [] as T[], pairs: [] as ComparisonPair<T>[] };
      for (let i = 0; i < partition.items.length; i++) {
        if (i === proposed) continue;
        const item = partition.items[i]!;
        const pair: ComparisonPair<T> = { id: `w${wave}_g${partition.key}_p${spec.pairs.length}`, left: item, right: pivot, leftIndex: i, rightIndex: proposed };
        spec.pairs.push(pair); allPairs.push(pair);
      }
      specs.set(partition.key, spec);
    }

    const groups = chunks(allPairs, batchSize(options.maxBatchSize, allPairs.length));
    const responses = await Promise.all(groups.map(async (pairs, batchIndex) => {
      assertNotAborted(options.signal); batchCalls++;
      const winners = await compareBatch(pairs, { wave, batch: batchIndex, totalBatches: groups.length, signal: options.signal });
      validateWinners(pairs, winners);
      return { pairs, winners };
    }));
    const winners = Object.assign({}, ...responses.map(response => response.winners)) as Readonly<Record<string, "left" | "right">>;
    comparisons += allPairs.length;
    for (const partition of active) {
      const spec = specs.get(partition.key)!;
      for (const pair of spec.pairs) (winners[pair.id] === "left" ? spec.before : spec.after).push(pair.left);
    }

    const next: Partition<T>[] = [];
    let nextKey = 0;
    for (const partition of partitions) {
      if (partition.items.length <= 1) { next.push({ key: nextKey++, items: partition.items }); continue; }
      const spec = specs.get(partition.key)!;
      if (spec.before.length) next.push({ key: nextKey++, items: spec.before });
      next.push({ key: nextKey++, items: [spec.pivot] });
      if (spec.after.length) next.push({ key: nextKey++, items: spec.after });
    }
    partitions = next;
    if (options.onWave) await options.onWave({ wave, comparisons: allPairs.length, items: partitions.flatMap(partition => partition.items) });
    wave++;
  }

  return { items: partitions.flatMap(partition => partition.items), stats: { algorithm: "quicksort", inputSize, waves: wave, comparisons, batchCalls } };
}

export { quickSort };
