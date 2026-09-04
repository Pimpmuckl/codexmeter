import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelName } from '../server/normalize.js';
import { getModelColor } from '../src/utils/colors.js';

test('model normalization canonicalizes odd hyphen and spacing variants for gpt-5.5', () => {
  assert.equal(normalizeModelName(' GPT‑5.5 '), 'gpt-5.5');
  assert.equal(normalizeModelName('gpt 5.5'), 'gpt-5.5');
  assert.equal(getModelColor(' GPT‑5.5 '), '#22c790');
});

test('model colors canonicalize gpt-5.4 mini variants before palette lookup', () => {
  assert.equal(normalizeModelName('GPT 5.4   mini'), 'gpt-5.4-mini');
  assert.equal(getModelColor('GPT 5.4   mini'), '#fb7185');
});

test('model colors include the gpt-5.6 family tiers', () => {
  assert.equal(getModelColor('gpt-5.6-sol'), '#f6c453');
  assert.equal(getModelColor('gpt-5.6-terra'), '#36b37e');
  assert.equal(getModelColor('gpt-5.6-luna'), '#8ab4ff');
  assert.equal(getModelColor('openai/gpt-5.6-sol'), '#f6c453');
});

test('model colors include gpt-6 Astra', () => {
  assert.equal(getModelColor('gpt-6-astra'), '#3E63DD');
});
