// Spam check for the contact form, using TypeSafe's Jev decision model.
// Jev answers a few yes/no questions about the message; the decision is made
// here in code, so it is easy to read and change. Off unless TYPESAFE_API_KEY
// is set. If the call fails, the message is treated as genuine (never lost).

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
};

export const YES = 0.7;
export const NO = 0.3;

// The truth table. Anything not clearly spam goes through.
export function decide(a) {
  if (a.meaningless >= YES) return { spam: true, why: 'meaningless' };
  if (a.selling >= YES && a.about_resohead <= NO) return { spam: true, why: 'sales pitch' };
  return { spam: false, why: 'genuine or unsure' };
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

// Returns { spam, why, answers } or null when the check is off or fails.
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
    const a = Object.fromEntries(Object.keys(QUESTIONS).map(k => [k, answers?.[k]?.noul]));
    if (Object.values(a).some(v => typeof v !== 'number')) throw new Error('TypeSafe: missing answers');
    return { ...decide(a), answers: a };
  } catch (e) {
    console.error('spam check failed, treating message as genuine:', e.message);
    return null;
  }
}
