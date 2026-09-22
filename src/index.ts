import quickSort from "./quicksort.js";

export { createJevClient } from "./client.js";
export type { JevBitonicSortOptions, JevClient, JevClientOptions, JevSortOptions } from "./client.js";

/** Default low-level algorithm: adaptive parallel quicksort. */
export default quickSort;
export { quickSort } from "./quicksort.js";
export type { QuickSortOptions, QuickSortStats } from "./quicksort.js";
export { default as bitonicSort, bitonicNetwork, paddedSize } from "./bitonic.js";
export type { BitonicSortStats, NetworkComparison, NetworkWave } from "./bitonic.js";
export type {
  BatchComparator,
  CompareBatchContext,
  ComparisonPair,
  PairWinner,
  SortOptions,
  SortResult,
  SortStats,
  WaveProgress,
} from "./shared.js";

/** Backward-compatible alias for the original bitonic implementation. */
export { default as jevSortBitonic } from "./bitonic.js";
