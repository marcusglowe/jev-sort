import assert from 'node:assert/strict';
import test from 'node:test';
import { bitonicNetwork, jevSort, paddedSize } from '../dist/index.js';

const numericComparator = async pairs => Object.fromEntries(
  pairs.map(pair => [pair.id, pair.left <= pair.right ? 'left' : 'right']),
);

test('calculates power-of-two padding', () => {
  assert.equal(paddedSize(0), 1);
  assert.equal(paddedSize(1), 1);
  assert.equal(paddedSize(5), 8);
  assert.equal(paddedSize(100), 128);
  assert.throws(() => paddedSize(-1), /non-negative/);
});

test('builds the expected fixed bitonic network', () => {
  const network = bitonicNetwork(8);
  assert.equal(network.length, 6);
  assert.deepEqual(network.map(wave => wave.length), [4, 4, 4, 4, 4, 4]);
  assert.throws(() => bitonicNetwork(7), /power of two/);
});

test('sorts an unpadded list using only pair winners', async () => {
  const result = await jevSort([7, 1, 9, 2, 5], numericComparator);
  assert.deepEqual(result.items, [1, 2, 5, 7, 9]);
  assert.equal(result.stats.inputSize, 5);
  assert.equal(result.stats.paddedSize, 8);
  assert.equal(result.stats.waves, 6);
  assert.ok(result.stats.comparisons > 0);
});

test('runs chunks in the same wave concurrently', async () => {
  let active = 0;
  let maximumActive = 0;
  const comparator = async pairs => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return Object.fromEntries(pairs.map(pair => [pair.id, pair.left <= pair.right ? 'left' : 'right']));
  };
  const result = await jevSort([8, 7, 6, 5, 4, 3, 2, 1], comparator, { maxBatchSize: 2 });
  assert.deepEqual(result.items, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(maximumActive, 2);
  assert.equal(result.stats.batchCalls, 12);
});

test('reports every completed wave', async () => {
  const waves = [];
  await jevSort([4, 3, 2, 1], numericComparator, { onWave: progress => waves.push(progress.wave) });
  assert.deepEqual(waves, [0, 1, 2]);
});

test('rejects missing or malformed pair answers', async () => {
  await assert.rejects(
    jevSort([2, 1], async () => ({})),
    /must return "left" or "right"/,
  );
});

test('honors an aborted signal before inference', async () => {
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(jevSort([2, 1], numericComparator, { signal: controller.signal }), /stopped/);
});
