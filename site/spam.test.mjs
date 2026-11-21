// node --test site/spam.test.mjs   (no network: the API is stubbed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, briefing, checkSpam } from './spam.mjs';

const fields = message => [
  { label: 'Your name', value: 'A' }, { label: 'Email', value: 'a@b.co' }, { label: 'Message', value: message },
];
const stub = (answers, ok = true) => async () => ({
  ok, status: ok ? 200 : 500, text: async () => 'boom',
  json: async () => ({ answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k,
    typeof v === 'number' ? { type: 'noul', noul: v } : { type: 'choice', choice: v[0], probabilities: { [v[0]]: v[1] } }])) }),
});
const genuine = { selling: 0.05, about_resohead: 0.9, meaningless: 0.01 };
const drums = { enquiry_type: { choice: 'remote_drum_recording', p: 0.9 }, deliverable: { choice: 'stems', p: 0.8 } };

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

test('brief truth table', () => {
  const b = briefing({ ...drums, has_guide_mix: 0.9, has_tempo: 0.1, has_references: 0.05, has_deadline: 0.5 });
  assert.equal(b.subject, '[Drum session] missing: BPM, references; unclear: deadline');
  assert.deepEqual(b.have, ['guide mix', 'stems']);
  assert.match(b.checklist, /\[ \] BPM \(missing\)/);
  const full = briefing({ ...drums, has_guide_mix: 0.9, has_tempo: 0.9, has_references: 0.9, has_deadline: 0.8 });
  assert.equal(full.subject, '[Drum session] brief complete');
  const notStated = briefing({ ...drums, deliverable: { choice: 'not_stated', p: 0.85 }, has_guide_mix: 0.9, has_tempo: 0.9, has_references: 0.9, has_deadline: 0.9 });
  assert.equal(notStated.subject, '[Drum session] missing: deliverable');
  const mix = briefing({ ...drums, enquiry_type: { choice: 'mixing_or_mastering', p: 0.75 }, deliverable: { choice: 'stems', p: 0.4 }, has_guide_mix: 0.9, has_tempo: 0.9, has_references: 0.9, has_deadline: 0.9 });
  assert.equal(mix.subject, '[Mixing] unclear: deliverable');
});

test('no brief for gigs, download questions or unsure enquiry type', () => {
  const rest = { has_guide_mix: 0.1, has_tempo: 0.1, has_references: 0.1, has_deadline: 0.1 };
  assert.equal(briefing({ ...drums, ...rest, enquiry_type: { choice: 'live_gig_or_dep', p: 0.95 } }), null);
  assert.equal(briefing({ ...drums, ...rest, enquiry_type: { choice: 'multitrack_download_question', p: 0.95 } }), null);
  assert.equal(briefing({ ...drums, ...rest, enquiry_type: { choice: 'remote_drum_recording', p: 0.5 } }), null);
});

test('brief comes back in the same call, only for genuine messages', async () => {
  const brief = { enquiry_type: ['remote_drum_recording', 0.9], deliverable: ['multitracks', 0.9], has_guide_mix: 0.9, has_tempo: 0.05, has_references: 0.9, has_deadline: 0.9 };
  const v = await checkSpam(fields('Can you drum on my song?'), { apiKey: 'k', fetchImpl: stub({ ...genuine, ...brief }) });
  assert.equal(v.spam, false);
  assert.equal(v.brief.subject, '[Drum session] missing: BPM');
  const s = await checkSpam(fields('We do SEO'), { apiKey: 'k', fetchImpl: stub({ selling: 0.95, about_resohead: 0.05, meaningless: 0.01, ...brief }) });
  assert.equal(s.spam, true);
  assert.equal(s.brief, null);
});

test('missing brief answers still give a spam verdict, with no brief', async () => {
  const v = await checkSpam(fields('hello'), { apiKey: 'k', fetchImpl: stub(genuine) });
  assert.equal(v.spam, false);
  assert.equal(v.brief, null);
});
