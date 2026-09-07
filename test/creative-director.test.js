import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerritories, negativePrompt, scoreConcept } from '../lib/creative-director.js';

test('creates three genuinely distinct creative territories', () => {
  const concepts = createTerritories({ name: 'Aster', category: 'robotics', seed: 10 });
  assert.equal(concepts.length, 3);
  assert.equal(new Set(concepts.map(item => item.prompt)).size, 3);
  assert.deepEqual(concepts.map(item => item.seed), [10, 1007, 2004]);
  assert.ok(concepts.every(item => item.prompt.includes('Aster')));
});

test('negative prompt prevents common logo-generation failure modes', () => {
  const prompt = negativePrompt({ avoid: 'owl symbols' });
  assert.match(prompt, /typography/);
  assert.match(prompt, /multiple logos/);
  assert.match(prompt, /owl symbols/);
});

test('weighted score rewards distinction most', () => {
  const base = { simplicity: 5, relevance: 5, memorability: 5, scalability: 5, balance: 5, longevity: 5 };
  assert.ok(scoreConcept({ scores: { ...base, distinction: 10 } }) > scoreConcept({ scores: { ...base, distinction: 0 } }));
});
