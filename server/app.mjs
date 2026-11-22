// New hire onboarding server: one request handler, written with standard Request and Response,
// so the same code runs in Node (server/node.mjs) and on Cloudflare Workers (server/worker.mjs).
//
//   GET  /api/config     -> { appId, region, guide, choices, company, sampleHandbook, samplePeople, sampleChecklist }
//   POST /api/session    -> { appId, region, sessionToken }      a short Spatius session for the avatar
//   POST /api/hear       -> recorded audio (x-lang header) -> { text }
//   POST /api/ask        -> { onboarding, question, step, history } -> { say, found, section, title, text, quote, person, who }
//                           (during a checklist step, "done" comes back as { done: true } without asking the LLM)
//   POST /api/speak      -> { text, lang }                      -> the voice, PCM16 mono 24 kHz (streamed)
//
// An "onboarding" is { lang, company, handbook, people, checklist } as text; the page keeps it and sends it each time.
// OpenAI is reached through OPENAI_BASE_URL. With your own OPENAI_API_KEY it is OpenAI itself.
// Without it, the requests go to the Spatius starter service, signed with your Spatius key.
// The rules of the guide itself are in brain.mjs.

import { LANGS, GUIDE, SAMPLE_COMPANY, SAMPLE_HANDBOOK, SAMPLE_PEOPLE, SAMPLE_CHECKLIST, hearingHint, voiceStyle, sectionsOf, pickSections, peopleOf, answerMessages, readAnswer, isDone } from './brain.mjs';

// The guide's Spatius avatar and OpenAI voice.
export const FACE = { name: GUIDE.name, avatarId: '94a457d0-fa28-4aa8-a37a-e41e9f448f89', voice: 'marin' };
const STARTER_URL = 'https://starter.spatius.app/v1';
const isStarter = (u) => /starter\.spatius\.app|demotius-starter/.test(u || '');
const pick = (v, list, d) => (list.includes(v) ? v : d);

export function settings(env) {
  const ownKey = !!env.OPENAI_API_KEY;
  // Your own OpenAI key only ever goes to OpenAI (or the OPENAI_BASE_URL you set), never to the starter service.
  const starterUrl = env.SPATIUS_STARTER_URL || STARTER_URL;
  const base = ownKey ? (env.OPENAI_BASE_URL && !isStarter(env.OPENAI_BASE_URL) ? env.OPENAI_BASE_URL : 'https://api.openai.com/v1') : starterUrl;
  return {
    apiKey: env.SPATIUS_API_KEY || '',
    appId: env.SPATIUS_APP_ID || '',
    region: env.SPATIUS_REGION || 'us-west',
    // where the page starts: the choices from the demo, or your own
    choices: {
      lang: pick(env.ONBOARDING_LANG, Object.keys(LANGS), 'en'),
      company: String(env.ONBOARDING_COMPANY || '').slice(0, 80),
    },
    // your own handbook, people and checklist, as text (instead of the samples)
    handbook: String(env.ONBOARDING_HANDBOOK || '').replace(/\\n/g, '\n').slice(0, 60000),
    people: String(env.ONBOARDING_PEOPLE || '').replace(/\\n/g, '\n').slice(0, 4000),
    checklist: String(env.ONBOARDING_CHECKLIST || '').replace(/\\n/g, '\n').slice(0, 2000),
    // seconds per session; 0 means no limit
    sessionSeconds: Math.max(0, Number(env.ONBOARDING_SECONDS ?? 180) || 0),
    openai: {
      base: base.replace(/\/$/, ''),
      key: ownKey ? env.OPENAI_API_KEY : env.SPATIUS_API_KEY,
      starter: !ownKey,
      chat: env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini',
      stt: env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe',
      tts: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    },
  };
}

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const bad = (message) => Object.assign(new Error(message), { status: 400 });
const readJson = async (request, max) => {
  const text = await request.text();
  if (text.length > max) throw bad('Too large.');
  try { return JSON.parse(text || '{}'); } catch { throw bad('Bad request.'); }
};

// Starter minutes left, passed on from the starter service when it sends them.
function starterHeaders(res) {
  const left = res.headers.get('x-starter-minutes-left');
  return left === null ? {} : { 'X-Starter-Minutes-Left': left };
}

// A clear message for each way OpenAI or the starter service can say no.
async function openaiError(res, s) {
  if (s.openai.starter && res.status === 402)
    return { status: 402, error: 'Your starter minutes are used. Add your own OPENAI_API_KEY to .env to keep going.', starterUsed: true };
  if (s.openai.starter && (res.status === 404 || res.status >= 500 || res.status === 0))
    return { status: 503, error: 'The starter service is not available right now. Try again, or add your own OPENAI_API_KEY to .env.' };
  if (res.status === 401) return { status: 401, error: s.openai.starter ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : 'Your OPENAI_API_KEY was not accepted.' };
  if (res.status === 429) return { status: 429, error: 'Too many requests to the language service. Please wait a moment.' };
  return { status: 502, error: `The language service answered with HTTP ${res.status}.` };
}

async function callOpenAI(s, path, init) {
  try {
    const starter = s.openai.starter ? { 'X-Spatius-Region': s.region } : {};
    return await fetch(`${s.openai.base}${path}`, { ...init, headers: { Authorization: `Bearer ${s.openai.key}`, ...starter, ...(init.headers || {}) } });
  } catch {
    // network failure: a plain object, because a Response cannot have status 0
    return { ok: false, status: 0, body: null, headers: new Headers(), json: async () => ({}), text: async () => '' };
  }
}

// ---------- Spatius session token (reused for 20 minutes) ----------
let tokenCache = { token: '', until: 0, key: '' };
async function sessionToken(s) {
  if (tokenCache.token && tokenCache.key === s.apiKey && Date.now() < tokenCache.until) return tokenCache.token;
  const domain = s.region.startsWith('cn') ? 'spatialwalk.top' : 'spatius.ai';
  const res = await fetch(`https://console.${s.region}.${domain}/v1/console/session-tokens`, {
    method: 'POST',
    headers: { 'X-Api-Key': s.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expireAt: Math.floor(Date.now() / 1000) + 3600 }),
  });
  // a wrong key can still come back as HTTP 200, so check for the token itself
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || !body.sessionToken) {
    const refused = res.status === 401 || res.status === 403 || (res.status === 200 && !body.sessionToken);
    const err = new Error(refused ? 'Your Spatius API key was not accepted. Check it at app.spatius.ai.' : `Spatius did not give a session (HTTP ${res.status}).`);
    err.status = refused ? 401 : 502;
    throw err;
  }
  tokenCache = { token: body.sessionToken, until: Date.now() + 20 * 60_000, key: s.apiKey };
  return body.sessionToken;
}

const str = (v, max) => String(v ?? '').slice(0, max);
/** The onboarding as the page sends it each time: the handbook, people and checklist as text, checked and trimmed. */
export function onboardingOf(s, b) {
  const c = b && typeof b.onboarding === 'object' ? b.onboarding : {};
  const handbook = str(c.handbook || s.handbook || SAMPLE_HANDBOOK, 60000);
  return {
    lang: pick(c.lang, Object.keys(LANGS), s.choices.lang),
    company: str(c.company || s.choices.company || (handbook === SAMPLE_HANDBOOK ? SAMPLE_COMPANY : ''), 80),
    handbook, people: peopleOf(str(c.people || s.people || SAMPLE_PEOPLE, 4000)),
  };
}
/** One question, answered from the handbook, with the person card when there is one. */
export function askOf(ob, b) {
  const question = str(b.question, 600).trim();
  if (!question) throw bad('Say or type a question first.');
  const all = sectionsOf(ob.handbook);
  if (!all.length) throw bad('The handbook is empty.');
  const step = str(b.step, 120).trim();
  const sections = pickSections(all, `${question} ${step}`);
  const history = (Array.isArray(b.history) ? b.history : []).slice(-6).map((h) => ({ who: h?.who === 'guide' ? 'guide' : 'you', text: str(h?.text, 500) }));
  return { question, step, sections, history };
}
/** The answer, with the section's text (so the page can highlight the words) and the colleague's card. */
export function withPerson(ob, a, sections = []) {
  const p = ob.people.find((x) => x.id === a.person);
  const sec = sections.find((x) => x.id === a.section);
  return { ...a, text: sec ? sec.text : '', who: p ? { name: p.name, role: p.role, about: p.about, contact: p.contact, photo: p.photo } : null };
}
async function chat(s, messages, maxTokens, temperature = 0.6) {
  return callOpenAI(s, '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.chat, temperature, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages }),
  });
}
async function answer(s, res, read) {
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  return json(200, read((await res.json().catch(() => ({}))).choices?.[0]?.message?.content), starterHeaders(res));
}

// ---------- hear: speech to text, told which language to expect ----------
async function hear(s, request) {
  const lang = pick(request.headers.get('x-lang') || '', Object.keys(LANGS), s.choices.lang);
  const audio = await request.arrayBuffer();
  if (audio.byteLength > 3_000_000) return json(413, { error: 'That recording was too long. Try a shorter question.' });
  const type = request.headers.get('content-type') || 'audio/webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), `speech.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  form.append('model', s.openai.stt);
  form.append('language', lang);
  form.append('prompt', hearingHint(lang));
  const res = await callOpenAI(s, '/audio/transcriptions', { method: 'POST', body: form });
  if (!res.ok) { const e = await openaiError(res, s); return json(e.status, e); }
  const body = await res.json().catch(() => ({}));
  return json(200, { text: String(body.text || '').trim().slice(0, 600) }, starterHeaders(res));
}

// ---------- speak: the guide's voice ----------
async function speak(s, request) {
  const b = await readJson(request, 20_000);
  const lang = pick(b.lang, Object.keys(LANGS), s.choices.lang);
  const input = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!input) return json(400, { error: 'Nothing to say.' });
  // response_format "pcm" is raw PCM16 mono at 24 kHz: exactly what the avatar takes, so it is passed on untouched
  const res = await callOpenAI(s, '/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.tts, voice: FACE.voice, input, response_format: 'pcm', instructions: voiceStyle(lang) }),
  });
  if (!res.ok || !res.body) { const e = await openaiError(res, s); return json(e.status, e); }
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'audio/pcm;rate=24000', 'Cache-Control': 'no-store', ...starterHeaders(res) } });
}

// A simple limit per visitor, so nobody can spend your keys by calling the API in a loop.
// It is kept in memory: enough for one server; use your host's rate limiting for more.
const hits = new Map();
function tooMany(request) {
  const ip = request.headers.get('cf-connecting-ip') || String(request.headers.get('x-forwarded-for') || '').split(',').pop().trim() || 'local';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > 40;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const s = settings(env);
  if (url.pathname.startsWith('/api/') && tooMany(request)) return json(429, { error: 'Too many requests. Please wait a minute.' });
  try {
    const p = url.pathname;
    if (p === '/api/config' && request.method === 'GET') {
      return json(200, {
        appId: s.appId, region: s.region, starter: s.openai.starter, choices: s.choices, sessionSeconds: s.sessionSeconds,
        guide: { name: FACE.name, avatarId: FACE.avatarId }, company: s.choices.company || (s.handbook ? '' : SAMPLE_COMPANY),
        handbook: s.handbook, people: s.people, checklist: s.checklist,
        sampleHandbook: SAMPLE_HANDBOOK, samplePeople: SAMPLE_PEOPLE, sampleChecklist: SAMPLE_CHECKLIST,
      });
    }
    if (p === '/api/session' && request.method === 'POST') {
      if (!s.apiKey || !s.appId) return json(500, { error: 'Add SPATIUS_API_KEY and SPATIUS_APP_ID to .env, then restart.' });
      return json(200, { appId: s.appId, region: s.region, sessionToken: await sessionToken(s) });
    }
    if (p === '/api/hear' && request.method === 'POST') return await hear(s, request);
    if (p === '/api/speak' && request.method === 'POST') return await speak(s, request);
    if (request.method !== 'POST' || p !== '/api/ask') return null;
    const b = await readJson(request, 120_000);
    const ob = onboardingOf(s, b);
    // during a checklist step, "done" ticks the task: decided in code, no LLM call
    if (str(b.step, 120).trim() && isDone(b.question, ob.lang)) return json(200, { done: true });
    const ask = askOf(ob, b);
    return await answer(s, await chat(s, answerMessages(ob, ask), 450, 0.2), (raw) => withPerson(ob, readAnswer(raw, ob, ask.sections), ask.sections));
  } catch (err) {
    return json(err.status || 500, { error: err.status === 400 ? err.message : err.message || 'Something went wrong.' });
  }
}
