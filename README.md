# jev-sort

Semantic sorting with TypeSafe Jev.

The high-level client scores each item independently against one anchored rubric, then sorts the numeric scores in ordinary code. This takes **O(n) Jev judgments** and batches naturally. The package also keeps the original pairwise quicksort and bitonic network for cases where relative comparisons matter more than throughput.

## Install

```bash
npm install jev-sort
```

Use Node 18 or newer and set `TYPESAFE_API_KEY`, or pass `apiKey` explicitly.

## Fast semantic sort

```js
import { createJevClient } from "jev-sort";

const jev = createJevClient();

const result = await jev.jevSort(
  startups,
  "most likely to become a durable independent company",
  {
    criteria: [
      "Exceptionally weak fit for the ordering rule.",
      "Clearly below-average fit.",
      "Mixed or roughly average fit.",
      "Clearly above-average fit.",
      "Exceptional fit for the ordering rule.",
    ],
  },
);

console.log(result.items);
console.log(result.stats);
// { algorithm: "score", judgments: startups.length, ... }
```

`jev.jevSort()` and `jev.scoreSort()` are aliases. They default to batches of 350 with four requests in flight. Override these when row size or API limits differ:

```js
await jev.jevSort(rows, rule, {
  maxBatchSize: 250,
  concurrency: 8,
  signal,
});
```

Use concrete domain anchors when ranking quality matters. Every batch uses the same rubric, which keeps scores comparable across a large collection.

## Pairwise precision path

For criteria that are difficult to score absolutely, use the retained pairwise quicksort:

```js
const result = await jev.quickSort(rows, "best response to the user's request");
```

This can distinguish close alternatives more directly, but needs roughly **O(n log n)** Jev judgments. The fixed-network implementation remains at `jev.bitonicSort()`.

## Low-level primitives

You can supply your own scorer without using the TypeSafe client:

```js
import { scoreSort } from "jev-sort";

const result = await scoreSort(rows, async entries => {
  return Object.fromEntries(
    entries.map(entry => [entry.id, { score: myScore(entry.item) }]),
  );
});
```

The root default export is the low-level Score sorter:

```js
import scoreSort from "jev-sort";
```

Pairwise quicksort is available as the named `quickSort` export.

## Why Score is the high-level default

For 1,000,000 rows:

- Independent Score: 1,000,000 Jev judgments
- Comparison sorting: roughly 20–30 million pairwise judgments

The final numeric sort is still O(n log n), but it happens locally and is usually negligible beside model calls. Pairwise sorting remains useful for refining a small top set or resolving close ties.

## Development

```bash
npm test
npm run typecheck
npm run pack:check
```
