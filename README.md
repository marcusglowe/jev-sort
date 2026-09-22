# jev sort

Parallel semantic sorting with a fixed bitonic comparison network.

`jev-sort` orders data that has no useful numeric key. You provide one batched asynchronous comparator that decides which item in each pair belongs earlier. The package owns the fixed network, power-of-two padding, parallel layers, answer validation, and compare-and-swaps.

It was designed for [Jev](https://typesafe.ai), TypeSafe's System One decision model, but it works with any pairwise comparator.

```bash
npm install jev-sort
```

## Usage

```ts
import { jevSort } from 'jev-sort';

const tickets = [
  { id: 'a', text: 'The export button is the wrong color.' },
  { id: 'b', text: 'Every invoice is being charged twice.' },
  { id: 'c', text: 'I cannot reset my password.' },
];

const result = await jevSort(tickets, async pairs => {
  // Send this whole layer to Jev in one request. Each question returns
  // "left" when pair.left belongs earlier, or "right" otherwise.
  return callJev(pairs, 'most urgent even if the customer sounds calm');
});

console.log(result.items);
console.log(result.stats);
// { inputSize: 3, paddedSize: 4, waves: 3, comparisons: ..., batchCalls: ... }
```

See [`examples/typesafe-http.mjs`](./examples/typesafe-http.mjs) for a complete Jev HTTP integration.

## Comparator contract

The comparator receives every independent comparison in the current network layer:

```ts
async function compareBatch(pairs, context) {
  return Object.fromEntries(
    pairs.map(pair => [pair.id, pair.left.rank <= pair.right.rank ? 'left' : 'right']),
  );
}
```

It must return one `"left"` or `"right"` winner for every pair ID. A winner means “belongs earlier,” regardless of the bitonic network's internal direction. Keep the semantic rule stable for an entire sort.

All comparisons in a layer are independent and can run in parallel. If a layer is too large for one model request, set `maxBatchSize`; chunks in the layer are still invoked concurrently:

```ts
await jevSort(items, compareBatch, { maxBatchSize: 64 });
```

## Progress and cancellation

```ts
const controller = new AbortController();

const result = await jevSort(items, compareBatch, {
  signal: controller.signal,
  onWave({ wave, totalWaves, items }) {
    console.log(`${wave + 1}/${totalWaves}`, items);
  },
});
```

## Complexity

For padded size $$m=2^k$$:

- Parallel layers: $$k(k+1)/2$$, or $$O(\log^2 n)$$
- Comparison slots: $$mk(k+1)/4$$, or $$O(n\log^2 n)$$
- Memory: $$O(n)$$
- Comparisons within one layer can run concurrently

The fixed network is predictable and highly parallel. Adaptive algorithms such as parallel quicksort usually use fewer comparisons, but have input-dependent depth and partition balance.

## Semantic comparator caveat

Natural-language preferences can be uncertain or non-transitive: A may beat B, B may beat C, and C may beat A. A sorting network still returns an order, but different valid sorting algorithms can produce different nearby ranks. Treat the result as a judgment under the supplied comparator, not objective truth.

## API

### `jevSort(input, compareBatch, options?)`

Returns `{ items, stats }`.

Options:

- `maxBatchSize`: maximum comparisons per comparator call
- `signal`: `AbortSignal`
- `onWave`: callback after each completed parallel layer

### `bitonicNetwork(size)`

Returns the fixed comparison layers for a power-of-two size.

### `paddedSize(n)`

Returns the next power of two, with a minimum of one.

## License

MIT
