# jev sort

Parallel semantic sorting for data without a useful numeric key.

You provide one batched asynchronous comparator that decides which item in each pair belongs earlier. `jev-sort` owns the algorithm, parallel rounds, answer validation, and data movement. It was designed for [Jev](https://typesafe.ai), TypeSafe's System One decision model, but works with any pairwise comparator.

```bash
npm install jev-sort
```

## TypeSafe API key

`jev-sort` is provider-agnostic and does not read credentials itself. To use it with Jev, create a TypeSafe API key and set it only in your server environment:

```bash
export TYPESAFE_API_KEY="your-key"
```

Never put the key in browser code or a public environment variable. Your server-side comparator sends each parallel batch to TypeSafe.

## Algorithms

```ts
import jevSort from 'jev-sort';             // parallel quicksort, the default
import quickSort from 'jev-sort/quicksort'; // same adaptive algorithm
import bitonicSort from 'jev-sort/bitonic'; // fixed sorting network
```

**Parallel quicksort** is the default. It usually uses fewer comparisons and rounds: expected $$O(n\log n)$$ comparisons and roughly $$O(\log n)$$ depth with balanced pivots.

**Bitonic sort** has a fixed, predictable execution graph and maximizes regular parallelism: $$O(n\log^2 n)$$ comparisons and $$O(\log^2 n)$$ depth.

## Usage

```ts
import jevSort from 'jev-sort';

const tickets = [
  { id: 'a', text: 'The export button is the wrong color.' },
  { id: 'b', text: 'Every invoice is being charged twice.' },
  { id: 'c', text: 'I cannot reset my password.' },
];

const orderingRule = 'most urgent even if the customer sounds calm';

const result = await jevSort(tickets, async pairs => {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'jev-latest',
      state: {
        ordering_rule: orderingRule,
        pairs: Object.fromEntries(pairs.map(pair => [pair.id, {
          item_a: pair.left,
          item_b: pair.right,
        }])),
      },
      questions: Object.fromEntries(pairs.map(pair => [pair.id, {
        type: 'choice',
        instructions: 'Which item belongs earlier according to `ordering_rule`?',
        criteria: {
          left: 'Item A belongs earlier.',
          right: 'Item B belongs earlier.',
        },
      }])),
    }),
  });

  if (!response.ok) throw new Error(`TypeSafe returned ${response.status}`);
  const payload = await response.json();
  return Object.fromEntries(
    pairs.map(pair => [pair.id, payload.answers[pair.id].choice]),
  );
});

console.log(result.items);
console.log(result.stats);
```

See [`examples/typesafe-http.mjs`](./examples/typesafe-http.mjs) for the runnable version.

## Comparator contract

Both algorithms use the same comparator:

```ts
async function compareBatch(pairs, context) {
  return Object.fromEntries(
    pairs.map(pair => [
      pair.id,
      pair.left.rank <= pair.right.rank ? 'left' : 'right',
    ]),
  );
}
```

It must return one `"left"` or `"right"` winner for every pair ID. A winner means “belongs earlier.” Keep the semantic rule stable for the entire sort.

Every comparison supplied in one round is independent. If a round is too large for one model request, `maxBatchSize` splits it into chunks that are still invoked concurrently:

```ts
await jevSort(items, compareBatch, { maxBatchSize: 64 });
```

## Choosing an algorithm

Use the default quicksort for most applications:

```ts
import jevSort from 'jev-sort';
```

Use bitonic sort when fixed wave count and predictable batches matter more than inference cost:

```ts
import bitonicSort from 'jev-sort/bitonic';

const result = await bitonicSort(items, compareBatch);
```

Use the explicit quicksort subpath when an import should document the choice:

```ts
import quickSort from 'jev-sort/quicksort';
```

Quicksort accepts a deterministic pivot policy:

```ts
await quickSort(items, compareBatch, {
  choosePivot(partition) {
    return Math.floor(partition.length / 2);
  },
});
```

## Progress and cancellation

```ts
const controller = new AbortController();

const result = await jevSort(items, compareBatch, {
  signal: controller.signal,
  onWave({ wave, totalWaves, items }) {
    console.log({ wave, totalWaves, items });
  },
});
```

`totalWaves` is known for bitonic sort and undefined for adaptive quicksort.

## Semantic comparator caveat

Natural-language preferences can be uncertain or non-transitive: A may beat B, B may beat C, and C may beat A. A sorting algorithm still returns an order, but quicksort and bitonic sort can produce different nearby ranks because they ask different pairs. Treat the result as a judgment under the supplied comparator, not objective truth.

## Exports

Root:

- default `quickSort`
- named `quickSort`, `bitonicSort`, `bitonicNetwork`, `paddedSize`
- shared TypeScript types

Subpaths:

- `jev-sort/quicksort`
- `jev-sort/bitonic`

## License

MIT
