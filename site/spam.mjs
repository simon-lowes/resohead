// Spam check and session brief check for the contact form, using TypeSafe's
// Jev decision model. Jev answers a few questions about the message in one
// call; the decisions are made here in code, so they are easy to read and
// change. Off unless TYPESAFE_API_KEY is set. If the call fails, the message
// is treated as genuine (never lost) and emailed with the usual subject.

const API_URL = 'https://api.typesafe.ai/v1/systemone';

// All wording and thresholds live here.
export const QUESTIONS = {
  selling: {
    type: 'noul',
    instructions: 'Is the sender of `message` trying to sell Resohead a product or service?',
    criteria: {
      true: 'The sender offers something for money, such as SEO, web design, marketing, followers, leads, loans, software or crypto.',
      false: 'The sender asks about, praises or wants to work with Resohead, or asks to buy Resohead\'s own music or services.',
    },
  },
  about_resohead: {
    type: 'noul',
    instructions: 'Does `message` refer to Resohead\'s music, recordings or work specifically?',
    criteria: {
      true: 'It mentions a track, an album, a download, a gig, mixing, a collaboration or something else on the Resohead site.',
      false: 'The same text could be sent unchanged to any website.',
    },
  },
  meaningless: {
    type: 'noul',
    instructions: 'Is `message` meaningless, such as random characters or test text?',
    criteria: {
      true: 'Random letters, keyboard mashing, "test", or words that do not form a message.',
      false: 'A person could understand what the sender means, even if it is short or badly spelt.',
    },
  },
  // Session brief: what the enquiry is, and which parts of the brief on the
  // site (guide mix, BPM, references, stereo mix / stems / multitracks) it has.
  enquiry_type: {
    type: 'choice',
    instructions: 'What is the sender of `message` asking Resohead for?',
    criteria: {
      remote_drum_recording: 'Drums recorded remotely for the sender\'s song or project.',
      mixing_or_mastering: 'Mixing or mastering of the sender\'s recordings.',
      production_or_overdubs: 'Production, arrangement or other instrument overdubs.',
      live_gig_or_dep: 'Playing a live gig, a tour or depping in a band.',
      multitrack_download_question: 'A question about Resohead\'s own downloads, multitracks or music.',
      collaboration_or_other: 'A collaboration idea or anything else.',
    },
  },
  has_guide_mix: {
    type: 'noul',
    instructions: 'Does `message` include, link or offer a guide mix or demo of the song?',
    criteria: {
      true: 'An mp3, demo or rough mix is attached or linked, or the sender says they will or can send one.',
      false: 'The song is described but no recording of it is attached, linked or offered.',
    },
  },
  has_tempo: {
    type: 'noul',
    instructions: 'Does `message` give the tempo of the song?',
    criteria: {
      true: 'A BPM number or a tempo map is given, attached or offered.',
      false: 'The song is mentioned without any BPM or tempo map.',
    },
  },
  has_references: {
    type: 'noul',
    instructions: 'Does `message` name or link reference songs or artists for the drum sound or style?',
    criteria: {
      true: 'A song, artist or band is named or linked as a reference, such as "sounds like Foo Fighters" or a YouTube link.',
      false: 'The style is described only in general words, or not at all.',
    },
  },
  deliverable: {
    type: 'choice',
    instructions: 'What does the sender of `message` want delivered back?',
    criteria: {
      stereo_mix: 'A single stereo mix of the drums or song.',
      stems: 'Grouped drum stems, such as kick, snare, toms and overheads.',
      multitracks: 'Every microphone as a separate multitrack file.',
      not_stated: 'The message does not say what files should be delivered.',
    },
  },
  has_deadline: {
    type: 'noul',
    instructions: 'Does `message` give a deadline or a date the work is needed by?',
    criteria: {
      true: 'A date, a week or a time frame for the finished work is given, such as "by March" or "in two weeks".',
      false: 'No date or time frame for the finished work is mentioned.',
    },
  },
};

const SPAM_KEYS = ['selling', 'about_resohead', 'meaningless'];

export const YES = 0.7;
export const NO = 0.3;

// The truth table. Anything not clearly spam goes through.
export function decide(a) {
  if (a.meaningless >= YES) return { spam: true, why: 'meaningless' };
  if (a.selling >= YES && a.about_resohead <= NO) return { spam: true, why: 'sales pitch' };
  return { spam: false, why: 'genuine or unsure' };
}

// Session brief truth table. Only drum recording or mixing enquiries that Jev
// is fairly sure about get a checklist: a gig or a question about downloads
// has no BPM, so a 'missing' list would be noise. Returns null otherwise.
const BRIEFED = { remote_drum_recording: 'Drum session', mixing_or_mastering: 'Mixing' };
const ITEMS = [['has_guide_mix', 'guide mix'], ['has_tempo', 'BPM'], ['has_references', 'references'], ['has_deadline', 'deadline']];

export function briefing(a) {
  const kind = BRIEFED[a.enquiry_type?.choice];
  if (!kind || !(a.enquiry_type.p >= YES)) return null;
  const have = [], missing = [], unclear = [];
  for (const [k, label] of ITEMS) {
    if (typeof a[k] !== 'number') unclear.push(label);
    else if (a[k] >= YES) have.push(label);
    else if (a[k] < NO) missing.push(label);
    else unclear.push(label);
  }
  const d = a.deliverable;
  const deliverable = d && d.p >= YES ? d.choice : null;
  if (deliverable === 'not_stated') missing.push('deliverable');
  else if (deliverable) have.push(deliverable.replace('_', ' '));
  else unclear.push('deliverable');
  const parts = [];
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (unclear.length) parts.push(`unclear: ${unclear.join(', ')}`);
  const subject = `[${kind}] ${parts.length ? parts.join('; ') : 'brief complete'}`;
  const checklist = [
    `${kind} enquiry (automatic check, may be wrong):`,
    ...have.map(x => `  [x] ${x}`), ...missing.map(x => `  [ ] ${x} (missing)`), ...unclear.map(x => `  [?] ${x} (unclear)`),
  ].join('\n');
  return { kind, have, missing, unclear, subject, checklist };
}

// Reads Jev's answers into plain values: a number for a Noul, and
// { choice, p } for a Choice. Missing answers are left undefined.
export function readAnswers(answers) {
  return Object.fromEntries(Object.entries(QUESTIONS).map(([k, q]) => {
    const r = answers?.[k];
    if (q.type === 'choice') {
      if (typeof r?.choice !== 'string') return [k, undefined];
      const p = r.probabilities?.[r.choice];
      return [k, { choice: r.choice, p: typeof p === 'number' ? p : 0 }];
    }
    return [k, r?.noul];
  }));
}

export function buildState(fields) {
  const get = label => (fields.find(f => f.label === label) || {}).value || '';
  return {
    site: 'Resohead, the website of a musician and producer',
    name: get('Your name'),
    email: get('Email'),
    message: get('Message'),
  };
}

// Returns { spam, why, answers, brief } or null when the check is off or fails.
export async function checkSpam(fields, { apiKey = process.env.TYPESAFE_API_KEY, model = process.env.JEV_MODEL || 'jev-latest', fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  const state = buildState(fields);
  if (!state.message) return null; // nothing to judge; let it through
  try {
    const r = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state, questions: QUESTIONS }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) throw new Error(`TypeSafe ${r.status}: ${await r.text()}`);
    const { answers } = await r.json();
    const a = readAnswers(answers);
    if (SPAM_KEYS.some(k => typeof a[k] !== 'number')) throw new Error('TypeSafe: missing answers');
    const verdict = decide(a);
    // Only messages that pass as genuine are briefed.
    return { ...verdict, answers: a, brief: verdict.spam ? null : briefing(a) };
  } catch (e) {
    console.error('spam check failed, treating message as genuine:', e.message);
    return null;
  }
}
