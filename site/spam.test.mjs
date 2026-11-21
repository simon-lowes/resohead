// node --test site/spam.test.mjs   (no network: the API is stubbed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, checkSpam } from './spam.mjs';

const fields = message => [
  { label: 'Your name', value: 'A' }, { label: 'Email', value: 'a@b.co' }, { label: 'Message', value: message },
];
const stub = (answers, ok = true) => async () => ({
  ok, status: ok ? 200 : 500, text: async () => 'boom',
  json: async () => ({ answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { type: 'noul', noul: v }])) }),
});

test('truth table', () => {
  assert.equal(decide({ selling: 0.9, about_resohead: 0.1, meaningless: 0.0 }).spam, true);
  assert.equal(decide({ selling: 0.9, about_resohead: 0.8, meaningless: 0.0 }).spam, false); // pitch that is about the music: let through
  assert.equal(decide({ selling: 0.5, about_resohead: 0.1, meaningless: 0.0 }).spam, false); // unsure: let through
  assert.equal(decide({ selling: 0.0, about_resohead: 0.0, meaningless: 0.95 }).spam, true);
  assert.equal(decide({ selling: 0.1, about_resohead: 0.9, meaningless: 0.0 }).spam, false);
});

test('off without a key', async () => {
  assert.equal(await checkSpam(fields('hi'), { apiKey: '' }), null);
});

test('flags a pitch', async () => {
  const v = await checkSpam(fields('We do SEO'), { apiKey: 'k', fetchImpl: stub({ selling: 0.95, about_resohead: 0.05, meaningless: 0.01 }) });
  assert.equal(v.spam, true);
});

test('API failure lets the message through', async () => {
  assert.equal(await checkSpam(fields('hello'), { apiKey: 'k', fetchImpl: stub({}, false) }), null);
  assert.equal(await checkSpam(fields('hello'), { apiKey: 'k', fetchImpl: stub({ selling: 0.9 }) }), null); // missing answers
});
