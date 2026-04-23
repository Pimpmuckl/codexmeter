import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelName } from '../server/normalize.js';
import { getModelColor } from '../src/utils/colors.js';

test('model normalization canonicalizes odd hyphen and spacing variants for gpt-5.5', () => {
  assert.equal(normalizeModelName(' GPT‑5.5 '), 'gpt-5.5');
  assert.equal(normalizeModelName('gpt 5.5'), 'gpt-5.5');
  assert.equal(getModelColor(' GPT‑5.5 '), '#22c7c7');
});

test('model colors canonicalize gpt-5.4 mini variants before palette lookup', () => {
  assert.equal(normalizeModelName('GPT 5.4   mini'), 'gpt-5.4-mini');
  assert.equal(getModelColor('GPT 5.4   mini'), '#fb7185');
});
