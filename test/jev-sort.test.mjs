import assert from 'node:assert/strict';
import test from 'node:test';
import jevSort, { bitonicSort, quickSort, bitonicNetwork, paddedSize } from '../dist/index.js';
import quickSortSubpath from '../dist/quicksort.js';
import bitonicSortSubpath from '../dist/bitonic.js';

const numericComparator = async pairs => Object.fromEntries(pairs.map(pair => [pair.id, pair.left <= pair.right ? 'left' : 'right']));

test('root default is parallel quicksort', () => {
  assert.equal(jevSort, quickSort);
  assert.equal(quickSort, quickSortSubpath);
  assert.equal(bitonicSort, bitonicSortSubpath);
});

test('calculates power-of-two padding', () => {
  assert.equal(paddedSize(0), 1); assert.equal(paddedSize(1), 1); assert.equal(paddedSize(5), 8); assert.equal(paddedSize(100), 128);
  assert.throws(() => paddedSize(-1), /non-negative/);
});

test('builds the expected fixed bitonic network', () => {
  const network = bitonicNetwork(8);
  assert.equal(network.length, 6);
  assert.deepEqual(network.map(wave => wave.length), [4, 4, 4, 4, 4, 4]);
  assert.throws(() => bitonicNetwork(7), /power of two/);
});

test('bitonic sorts an unpadded list', async () => {
  const result = await bitonicSort([7, 1, 9, 2, 5], numericComparator);
  assert.deepEqual(result.items, [1, 2, 5, 7, 9]);
  assert.equal(result.stats.algorithm, 'bitonic'); assert.equal(result.stats.paddedSize, 8); assert.equal(result.stats.waves, 6);
});

test('default quicksort sorts and uses fewer comparisons', async () => {
  const values = [12, 3, 18, 1, 7, 14, 5, 9, 2, 16, 11, 4, 20, 8, 6, 19, 10, 15, 13, 17];
  const quick = await jevSort(values, numericComparator);
  const bitonic = await bitonicSort(values, numericComparator);
  assert.deepEqual(quick.items, [...values].sort((a,b) => a-b));
  assert.equal(quick.stats.algorithm, 'quicksort');
  assert.ok(quick.stats.comparisons < bitonic.stats.comparisons);
});

test('quicksort advances all active partitions in parallel', async () => {
  const activeCounts = [];
  const result = await quickSort([8,7,6,5,4,3,2,1], async (pairs, context) => {
    activeCounts.push({ wave: context.wave, count: pairs.length });
    return numericComparator(pairs);
  });
  assert.deepEqual(result.items, [1,2,3,4,5,6,7,8]);
  assert.ok(result.stats.waves >= 3);
  assert.equal(activeCounts.length, result.stats.waves);
});

test('runs chunks in the same bitonic wave concurrently', async () => {
  let active = 0, maximumActive = 0;
  const comparator = async pairs => { active++; maximumActive = Math.max(maximumActive, active); await new Promise(r => setTimeout(r,15)); active--; return numericComparator(pairs); };
  const result = await bitonicSort([8,7,6,5,4,3,2,1], comparator, { maxBatchSize: 2 });
  assert.deepEqual(result.items, [1,2,3,4,5,6,7,8]); assert.equal(maximumActive, 2); assert.equal(result.stats.batchCalls, 12);
});

test('validates pivot selection', async () => {
  await assert.rejects(quickSort([2,1], numericComparator, { choosePivot: () => 5 }), /valid partition index/);
});

test('rejects malformed answers in both algorithms', async () => {
  await assert.rejects(quickSort([2,1], async () => ({})), /must return "left" or "right"/);
  await assert.rejects(bitonicSort([2,1], async () => ({})), /must return "left" or "right"/);
});

test('honors an aborted signal', async () => {
  const controller = new AbortController(); controller.abort(new Error('stopped'));
  await assert.rejects(jevSort([2,1], numericComparator, { signal: controller.signal }), /stopped/);
});
