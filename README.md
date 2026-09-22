# jev sort

**Sort any list of any size by any criteria.**

Powered by [Jev](https://typesafe.ai).

```bash
npm install jev-sort
```

Set your TypeSafe API key in the server environment:

```bash
export TYPESAFE_API_KEY="your-key"
```

Then sort any JSON-safe dataset with one natural-language rule:

```ts
import { createJevClient } from 'jev-sort';

const { jevSort } = createJevClient({
  apiKey: process.env.TYPESAFE_API_KEY,
});

const tickets = [
  { id: 'a', text: 'The export button is the wrong color.' },
  { id: 'b', text: 'Every invoice is being charged twice.' },
  { id: 'c', text: 'I cannot reset my password.' },
];

const result = await jevSort(
  tickets,
  'most urgent even if the customer sounds calm',
);

console.log(result.items);
console.log(result.stats);
```

That is the complete Jev integration. The package uses TypeSafe's official SDK internally and owns question construction, parallel batching, authentication, retries, response parsing, and sorting. Keep the key on the server; never ship it in browser code.

`createJevClient()` also reads `TYPESAFE_API_KEY` automatically, so this works after setting the environment variable:

```ts
const { jevSort } = createJevClient();
```

## Algorithms

Parallel quicksort is the default because it usually uses fewer Jev calls and rounds:

```ts
const { jevSort, quickSort } = createJevClient({ apiKey });

await jevSort(items, orderingRule);  // quicksort
await quickSort(items, orderingRule); // explicit alias
```

Use the fixed bitonic sorting network when predictable wave count and regular batches matter more than inference cost:

```ts
const { bitonicSort } = createJevClient({ apiKey });

await bitonicSort(items, orderingRule);
```

- Parallel quicksort: expected $$O(n\log n)$$ comparisons and roughly $$O(\log n)$$ depth with balanced pivots
- Bitonic sort: $$O(n\log^2 n)$$ comparisons and $$O(\log^2 n)$$ fixed depth

## Customizing what Jev sees

Items must be JSON-safe. Use `serialize` to omit private, irrelevant, or large fields:

```ts
await jevSort(emails, 'deserves attention soonest', {
  serialize(email) {
    return {
      from: email.from,
      subject: email.subject,
      snippet: email.snippet,
    };
  },
});
```

A TypeSafe Choice request supports up to 255 questions. The client automatically chunks larger rounds and runs those chunks concurrently. You can choose a smaller batch:

```ts
await jevSort(items, rule, { maxBatchSize: 64 });
```

## Progress and cancellation

```ts
const controller = new AbortController();

const result = await jevSort(items, rule, {
  signal: controller.signal,
  onWave({ wave, totalWaves, items }) {
    console.log({ wave, totalWaves, items });
  },
});
```

`totalWaves` is known for bitonic sort and undefined for adaptive quicksort.

## Low-level algorithm API

If you use another decision provider or want full control over TypeSafe requests, import the provider-agnostic algorithms directly:

```ts
import quickSort from 'jev-sort/quicksort';
import bitonicSort from 'jev-sort/bitonic';
```

Both accept a batched comparator that returns `"left"` or `"right"` for every pair ID. The package root also defaults to the low-level quicksort function:

```ts
import quickSort from 'jev-sort';
```

See [`examples/typesafe-http.mjs`](./examples/typesafe-http.mjs) for the simple first-party client example.

## Semantic comparator caveat

Natural-language preferences can be uncertain or non-transitive: A may beat B, B may beat C, and C may beat A. An algorithm still returns an order, but quicksort and bitonic sort can produce different nearby ranks because they ask different pairs. Treat the result as a judgment under the supplied rule, not objective truth.

## License

MIT
