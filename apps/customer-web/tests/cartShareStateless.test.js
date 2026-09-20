import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeCartItems,
  buildCartShareUrl,
  parseSharedCartItems,
} from '../src/utils/cartShareUtils.js';

test('cartShareUtils: serializeCartItems produces compact id:qty format for simple products', () => {
  const items = [
    { id: 101, quantity: 2 },
    { id: 205, quantity: 1 },
    { id: 300, quantity: 5 },
  ];
  const serialized = serializeCartItems(items);
  assert.equal(serialized, '101:2,205:1,300:5');
});

test('cartShareUtils: serializeCartItems preserves variable products with variation_id and attributes', () => {
  const items = [
    {
      id: 500,
      quantity: 1,
      variation_id: 502,
      variation: [
        { attribute: 'pa_size', value: 'xl' },
        { attribute: 'pa_color', value: 'navy blue' },
      ],
    },
    { id: 101, quantity: 3 },
  ];
  const serialized = serializeCartItems(items);
  assert.equal(serialized, '500:1:502:pa_size=xl;pa_color=navy%20blue,101:3');
});

test('cartShareUtils: serializeCartItems ignores invalid, negative, or zero IDs', () => {
  const items = [
    { id: -5, quantity: 2 },
    { id: 'abc', quantity: 1 },
    { id: 0, quantity: 1 },
    { id: 450, quantity: 0 }, // quantity defaults to 1
  ];
  const serialized = serializeCartItems(items);
  assert.equal(serialized, '450:1');
});

test('cartShareUtils: buildCartShareUrl formats complete URL', () => {
  const items = [{ id: 101, quantity: 2 }];
  const url = buildCartShareUrl(items, 'https://mumbaicollection.in');
  assert.equal(url, 'https://mumbaicollection.in/cart?items=101%3A2');
});

test('cartShareUtils: buildCartShareUrl falls back to /cart if empty', () => {
  const url = buildCartShareUrl([], 'https://mumbaicollection.in');
  assert.equal(url, 'https://mumbaicollection.in/cart');
});

test('cartShareUtils: parseSharedCartItems extracts and deduplicates simple products', () => {
  const query = '?items=101:2,205:1,101:3';
  const parsed = parseSharedCartItems(query);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { id: 101, quantity: 5, variationId: null, variation: [] });
  assert.deepEqual(parsed[1], { id: 205, quantity: 1, variationId: null, variation: [] });
});

test('cartShareUtils: parseSharedCartItems restores variable product variationId and attributes', () => {
  const query = '?items=500:1:502:pa_size=xl;pa_color=navy%20blue';
  const parsed = parseSharedCartItems(query);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 500);
  assert.equal(parsed[0].quantity, 1);
  assert.equal(parsed[0].variationId, 502);
  assert.deepEqual(parsed[0].variation, [
    { attribute: 'pa_size', value: 'xl' },
    { attribute: 'pa_color', value: 'navy blue' },
  ]);
});

test('cartShareUtils: parseSharedCartItems deduplicates identical variations and sums quantity', () => {
  const query = '?items=500:1:502:pa_size=xl,500:2:502:pa_size=xl';
  const parsed = parseSharedCartItems(query);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 500);
  assert.equal(parsed[0].quantity, 3);
  assert.equal(parsed[0].variationId, 502);
});

test('cartShareUtils: parseSharedCartItems distinguishes different variations of same parent product', () => {
  const query = '?items=500:1:502:pa_size=m,500:2:503:pa_size=l';
  const parsed = parseSharedCartItems(query);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 500);
  assert.equal(parsed[0].variationId, 502);
  assert.equal(parsed[0].quantity, 1);
  assert.equal(parsed[1].id, 500);
  assert.equal(parsed[1].variationId, 503);
  assert.equal(parsed[1].quantity, 2);
});

test('cartShareUtils: parseSharedCartItems discards malformed segments and caps quantities at 99', () => {
  const query = '?items=invalid,205:999,300:-2,NaN:5';
  const parsed = parseSharedCartItems(query);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, 205);
  assert.equal(parsed[0].quantity, 99);
  assert.equal(parsed[1].id, 300);
  assert.equal(parsed[1].quantity, 1);
});

test('cartShareUtils: parseSharedCartItems safely handles empty, null, or undefined strings', () => {
  assert.deepEqual(parseSharedCartItems(''), []);
  assert.deepEqual(parseSharedCartItems(null), []);
  assert.deepEqual(parseSharedCartItems(undefined), []);
  assert.deepEqual(parseSharedCartItems('?other=value'), []);
});
