import scoreSort from "./score.js";

export { createJevClient, jevSort as sortWithJev } from "./client.js";
export type { JevClient, JevClientConfig, JevQuickSortOptions, JevScoreOptions, JevSortOptions } from "./client.js";

/** Default low-level algorithm: independent Score batches followed by a local numeric sort. */
export default scoreSort;
export { quickSort } from "./quicksort.js";
export type { QuickSortOptions, QuickSortStats } from "./quicksort.js";
export { default as scoreSort } from "./score.js";
export type { BatchScorer, ScoreEntry, ScoreSortOptions, ScoreSortStats, ScoreValue } from "./score.js";
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
