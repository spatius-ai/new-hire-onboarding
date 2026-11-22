// New hire onboarding: a Spatius avatar answers first-week questions from your handbook, shows the source,
// walks through the first-week checklist, and says who to ask.
import './onboarding.css';
import { canDraw, initSdk, loadSeat, type Seat } from './seat';

type Lang = 'en' | 'es' | 'zh' | 'ar' | 'fr';
type Who = { name: string; role: string; about: string; contact: string; photo: string };
type Answer = { say: string; found: boolean; section: string; title: string; text: string; quote: string; person: string; why: string; who: Who | null; done?: boolean; error?: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const esc = (t: string) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const track = (name: string, props: Record<string, unknown> = {}) => { if (parent !== window) parent.postMessage({ type: 'spatius-event', demo: 'new-hire-onboarding', name, props }, '*'); };
const SESSION_SECONDS = 180;

// What the guide says on her own, in each language
const LINES: Record<Lang, { hi: (c: string) => string; step: (t: string) => string; next: string; all: string; tries: string[]; triesOwn: string[] }> = {
  en: { hi: (c) => `Hi, I'm Sofia, your onboarding guide${c ? ` at ${c}` : ''}. Ask me anything about your first week, or press "Walk me through my first week".`, step: (t) => `How do I do this: ${t}?`, next: 'Great, that one is done.', all: "That's everything on your first-week list. Well done!", tries: ['When is payday?', 'Can I work from home?', 'Can I claim a taxi?', 'Where can I park?'], triesOwn: ['When is payday?', 'How do I book time off?', 'Who do I ask about my laptop?'] },
  es: { hi: (c) => `Hola, soy Sofia, tu guía de bienvenida${c ? ` en ${c}` : ''}. Pregúntame lo que quieras sobre tu primera semana, o pulsa "Walk me through my first week".`, step: (t) => `¿Cómo hago esto?: ${t}`, next: 'Genial, eso ya está.', all: 'Ya está todo lo de tu primera semana. ¡Muy bien!', tries: ['¿Cuándo es el día de pago?', '¿Puedo trabajar desde casa?', '¿Puedo pedir un taxi?', '¿Dónde puedo aparcar?'], triesOwn: ['¿Cuándo es el día de pago?', '¿Cómo pido vacaciones?', '¿A quién pregunto por mi portátil?'] },
  zh: { hi: (c) => `你好，我是 Sofia，${c ? `${c} 的` : ''}入职向导。关于第一周的任何问题都可以问我，或者点 "Walk me through my first week"。`, step: (t) => `这一项怎么做：${t}？`, next: '太好了，这一项完成了。', all: '第一周的清单全部完成了，做得好！', tries: ['什么时候发工资？', '我可以在家工作吗？', '可以报销出租车吗？', '我可以在哪里停车？'], triesOwn: ['什么时候发工资？', '怎么请假？', '电脑的问题问谁？'] },
  ar: { hi: (c) => `مرحبًا، أنا صوفيا، مرشدتك في الأسبوع الأول${c ? ` في ${c}` : ''}. اسألني أي شيء عن أسبوعك الأول، أو اضغط "Walk me through my first week".`, step: (t) => `كيف أقوم بهذا: ${t}؟`, next: 'رائع، تم هذا البند.', all: 'أنهيت كل قائمة الأسبوع الأول. أحسنت!', tries: ['متى يوم الراتب؟', 'هل يمكنني العمل من المنزل؟', 'هل يمكنني طلب سيارة أجرة؟', 'أين يمكنني ركن سيارتي؟'], triesOwn: ['متى يوم الراتب؟', 'كيف أطلب إجازة؟', 'من أسأل عن حاسوبي؟'] },
  fr: { hi: (c) => `Bonjour, je suis Sofia, ta guide d'accueil${c ? ` chez ${c}` : ''}. Pose-moi n'importe quelle question sur ta première semaine, ou appuie sur "Walk me through my first week".`, step: (t) => `Comment je fais ceci : ${t} ?`, next: "Parfait, c'est fait.", all: "Toute ta liste de la première semaine est faite. Bravo !", tries: ['Quand est le jour de paie ?', 'Puis-je télétravailler ?', 'Puis-je prendre un taxi ?', 'Où puis-je me garer ?'], triesOwn: ['Quand est le jour de paie ?', 'Comment poser des congés ?', 'Qui contacter pour mon ordinateur ?'] },
};

const st = {
  lang: 'en' as Lang, company: '', handbook: '', people: '', checklist: '', own: false,
  items: [] as { text: string; done: boolean }[], walking: -1, met: new Map<string, Who>(), asked: 0,
  history: [] as { who: 'you' | 'guide'; text: string }[], busy: false, live: false, ends: 0, sessionSeconds: SESSION_SECONDS,
};
const stage = $('#stage'), stateEl = $('#state');
let cfg: { appId: string; region: string; guide: { name: string; avatarId: string }; company: string; handbook: string; people: string; checklist: string; sampleHandbook: string; samplePeople: string; sampleChecklist: string; choices?: { lang: Lang }; sessionSeconds?: number } | null = null;
let seat: Seat | null = null, seatLoading: Promise<Seat | null> | null = null, drawable = true, clockT = 0, plainCtx: AudioContext | null = null;

// ---------- the avatar: seated behind the welcome desk ----------
const FIT = { x: 0, y: 0.1, scale: 0.68 };
function fitAvatar(view: any, tries = 40) { try { view.avatarTransform = FIT; } catch { if (tries > 0) setTimeout(() => fitAvatar(view, tries - 1), 150); } }
function getSeat(): Promise<Seat | null> {
  if (!cfg || !drawable) return Promise.resolve(null);
  return (seatLoading ??= (async () => {
    $('#load').textContent = `${cfg!.guide.name} is joining…`; $('#load').classList.add('on');
    try {
      const r = await fetch('api/session', { method: 'POST' }); const s = await r.json();
      if (!r.ok) throw new Error(s.error || 'No session.');
      await initSdk(s);
      const { start, view } = await loadSeat($('#avatar'), cfg!.guide.avatarId, (f) => ($('#load').textContent = `${cfg!.guide.name} is joining… ${Math.round(f * 100)}%`));
      (window as any).__pv = view; fitAvatar(view);
      seat = await start(); void seat.connect().catch(() => undefined);
      $('#avatarBox').classList.add('live');
      return seat;
    } catch (e) { console.warn('[onboarding] voice only', e); drawable = false; return null; }
    finally { $('#load').classList.remove('on'); }
  })());
}

// ---------- the voice: PCM16 24 kHz straight from the server to the avatar ----------
async function voice(text: string) {
  const r = await fetch('api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang: st.lang }) });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || 'The voice did not come through.');
  const reader = r.body.getReader(); let held = new Uint8Array(0); let ended = false;
  return async (): Promise<Int16Array | null> => {
    for (;;) {
      if (held.length >= 9600 || (ended && held.length >= 2)) { const whole = held.length - (held.length % 2); const out = new Int16Array(held.slice(0, whole).buffer); held = held.slice(whole); return out; }
      if (ended) return null;
      const { value, done } = await reader.read();
      if (done) { ended = true; continue; }
      const n = new Uint8Array(held.length + value.length); n.set(held); n.set(value, held.length); held = n;
    }
  };
}
async function playPlain(next: () => Promise<Int16Array | null>) {
  const ctx = new AudioContext({ sampleRate: 24000 }); plainCtx = ctx; let at = ctx.currentTime + 0.05;
  for (let c = await next(); c && ctx.state !== 'closed'; c = await next()) { const buf = ctx.createBuffer(1, c.length, 24000); const ch = buf.getChannelData(0); for (let i = 0; i < c.length; i++) ch[i] = c[i] / 32768; const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination); src.start(at); at += buf.duration; }
  if (ctx.state !== 'closed') await new Promise((r) => setTimeout(r, Math.max(0, (at - ctx.currentTime) * 1000)));
}
function hush() { seat?.interrupt(); if (plainCtx && plainCtx.state !== 'closed') void plainCtx.close(); plainCtx = null; }
const setState = (t: string) => { stateEl.textContent = t; };
async function say(text: string) {
  if (!text) return;
  showSaid(text, true); st.history.push({ who: 'guide', text }); setState('Speaking');
  try { const next = await voice(text); const s = await getSeat(); if (s) await s.stream(next).done; else await playPlain(next); }
  catch (e) { console.warn(e); }
  finally { if (st.live) setState(st.walking >= 0 ? 'Say "done" or ask' : 'Your turn'); }
}
function showSaid(text: string, guide: boolean) {
  $('#who').textContent = guide ? `${cfg?.guide.name || 'Sofia'} · Onboarding guide` : 'You';
  $('#said').textContent = text;
}

// ---------- the panel ----------
function showTries() {
  const list = st.own ? LINES[st.lang].triesOwn : LINES[st.lang].tries;
  $('#tries').innerHTML = list.map((t) => `<button type="button" dir="auto">${esc(t)}</button>`).join('');
}
/** The section's text with the exact words highlighted (or the sentence that holds most of them). */
function highlight(text: string, quote: string) {
  const t = esc(text); if (!quote) return t;
  const q = esc(quote.trim().replace(/[.。]$/, ''));
  const at = t.toLowerCase().indexOf(q.toLowerCase());
  if (at >= 0) return `${t.slice(0, at)}<mark>${t.slice(at, at + q.length)}</mark>${t.slice(at + q.length)}`;
  const words = new Set(q.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
  const parts = t.split(/(?<=[.!?。])\s+/);
  let best = -1, bi = -1; parts.forEach((p, i) => { const n = p.toLowerCase().split(/\s+/).filter((w) => words.has(w)).length; if (n > best) { best = n; bi = i; } });
  return parts.map((p, i) => (i === bi && best > 1 ? `<mark>${p}</mark>` : p)).join(' ');
}
function showSource(a: Answer) {
  const box = $('#source'); box.hidden = false;
  const tag = $('#srcTag'); tag.textContent = a.found ? 'From the handbook' : 'Not in the handbook'; tag.classList.toggle('no', !a.found);
  $('#srcTitle').textContent = a.found ? a.title : '';
  $('#srcText').innerHTML = a.found ? highlight(a.text, a.quote) : 'The guide does not guess. Ask the person she named, above.';
}
/** The people row, from the people list as text (the sample has an id and a photo; your own lines are name | role | about | contact). */
type Face = { id: string; name: string; role: string; photo: string };
function facesOf(text: string): Face[] {
  return text.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 3 && p[0]).slice(0, 8)
    .map((p) => (p.length >= 6 ? { id: p[0], name: p[1], role: p[2], photo: p[5] } : { id: p[0].toLowerCase(), name: p[0], role: p[1], photo: '' }));
}
function showFaces(lit = '') {
  const list = facesOf(st.people);
  $('#faces').classList.toggle('lit', !!lit);
  $('#faces').innerHTML = list.map((f) => `<div class="face${f.name === lit ? ' on' : ''}"><span class="ph">${f.photo ? `<img src="${esc(f.photo)}" alt="">` : esc(f.name.slice(0, 1).toUpperCase())}</span><b>${esc(f.name)}</b><small>${esc(f.role)}</small></div>`).join('');
}
/** Who do I ask?: the colleague Sofia names lights up in the row, with what to ask and a message button. */
function showPerson(w: Who | null, why = '') {
  showFaces(w?.name || '');
  const card = $('#whoCard'); if (!w) { card.hidden = true; return; }
  card.hidden = false;
  $('#whoAsk').textContent = why ? `Ask ${w.name} ${why}` : `Ask ${w.name} about: ${w.about}`;
  const btn = $<HTMLAnchorElement>('#pBtn'); btn.textContent = `Message ${w.name} ↗`;
  if (w.contact) { btn.href = w.contact; btn.removeAttribute('aria-disabled'); } else { btn.removeAttribute('href'); btn.setAttribute('aria-disabled', 'true'); }
  st.met.set(w.name, w);
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
/** Your first week: one task a day, Monday to Friday (more than five tasks share Friday). */
function showChecklist() {
  const done = st.items.filter((i) => i.done).length;
  $('#ckCount').textContent = st.items.length ? `${done} of ${st.items.length} done` : '';
  const byDay: number[][] = DAYS.map(() => []);
  st.items.forEach((_, k) => byDay[Math.min(k, 4)].push(k));
  $('#ckList').innerHTML = byDay.map((ks, d) => ks.map((k) => { const it = st.items[k];
    return `<li class="day${it.done ? ' done' : ''}${k === st.walking ? ' now' : ''}"><label><span class="dn">${DAYS[d]}<input type="checkbox" data-k="${k}" ${it.done ? 'checked' : ''} aria-label="${esc(it.text)}"></span><span class="tk" dir="auto">${esc(it.text)}</span></label></li>`; }).join('')).join('');
  $('#walk').textContent = st.walking >= 0 ? 'Done, next task' : done === st.items.length && st.items.length ? 'All done' : 'Walk me through my first week';
  ($('#walk') as HTMLButtonElement).disabled = !st.items.length || (done === st.items.length && st.walking < 0);
}

// ---------- a session ----------
function clock(left: number) { $('#clock').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; }
const onboarding = () => ({ lang: st.lang, company: st.company, handbook: st.handbook, people: st.people });
async function ask(question: string, step = ''): Promise<Answer> {
  const r = await fetch('api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboarding: onboarding(), question, step, history: st.history.slice(-6) }) });
  const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d as Answer;
}
async function start() {
  if (st.busy) return;
  hush(); st.busy = true; st.history = []; st.met.clear(); st.asked = 0; st.walking = -1; void getSeat();
  $('#score').classList.remove('on'); $('#source').hidden = true; showPerson(null); showChecklist();
  stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  st.live = true; stage.classList.add('oncall'); window.clearInterval(clockT);
  if (st.sessionSeconds) { st.ends = Date.now() + st.sessionSeconds * 1000; clockT = window.setInterval(() => { const left = Math.max(0, Math.round((st.ends - Date.now()) / 1000)); clock(left); if (!left) void end(); }, 500); }
  track('session_start', { lang: st.lang, own: st.own });
  try { await say(LINES[st.lang].hi(st.company)); $('#q').focus(); } finally { st.busy = false; }
}
async function send(text: string) {
  text = text.trim(); if (!text || st.busy) return;
  if (!st.live) { await start(); }
  st.busy = true; hush(); showSaid(text, false); setState('Thinking'); st.history.push({ who: 'you', text });
  const step = st.walking >= 0 ? st.items[st.walking]?.text || '' : '';
  try {
    const a = await ask(text, step);
    if (a.done) { await tick(st.walking); return; }
    st.asked++; showSource(a); showPerson(a.who, a.why);
    track('ask', { found: a.found, person: !!a.who, step: !!step });
    await say(a.say);
  } catch (e) { showSaid((e as Error).message, false); }
  finally { st.busy = false; if (st.live && stateEl.textContent === 'Thinking') setState('Your turn'); }
}
/** The checklist: the guide explains the next task from the handbook, then waits for "done" or a click. */
async function walk() {
  if (st.busy) return;
  if (!st.live) await start();
  if (st.walking >= 0) { await tick(st.walking); return; }
  const k = st.items.findIndex((i) => !i.done); if (k < 0) return;
  await explain(k);
}
async function explain(k: number) {
  st.walking = k; showChecklist(); st.busy = true; setState('Thinking');
  try {
    const a = await ask(LINES[st.lang].step(st.items[k].text), st.items[k].text);
    showSource(a); showPerson(a.who, a.why); track('checklist_step', { k, found: a.found });
    await say(a.say);
  } catch (e) { showSaid((e as Error).message, false); }
  finally { st.busy = false; }
}
async function tick(k: number) {
  if (k < 0 || !st.items[k]) return;
  st.items[k].done = true; track('checklist_done', { k });
  const next = st.items.findIndex((i) => !i.done);
  st.walking = -1; showChecklist(); st.busy = false;
  if (next < 0) { await say(LINES[st.lang].all); return; }
  await say(LINES[st.lang].next); await explain(next);
}
async function end() {
  if (!st.live) return;
  st.live = false; st.walking = -1; window.clearInterval(clockT); hush(); stage.classList.remove('oncall'); setState('Ended'); showChecklist();
  const done = st.items.filter((i) => i.done).length;
  const people = [...st.met.values()];
  $('#scoreBox').innerHTML = `
    <div><h3 class="hp-type-card-title" id="scoreTitle">Your first week so far</h3><p class="sum hp-type-card-copy">${st.asked} question${st.asked === 1 ? '' : 's'} answered · ${done} of ${st.items.length} tasks done</p></div>
    ${people.length ? `<span class="k hp-type-mono">People to meet</span><ul class="recap">${people.map((w) => `<li>${w.photo ? `<img src="${esc(w.photo)}" alt="">` : ''}<span><b>${esc(w.name)}</b> · ${esc(w.role)}</span>${w.contact ? `<a href="${esc(w.contact)}" target="_blank" rel="noopener">Message ↗</a>` : ''}</li>`).join('')}</ul>` : ''}
    ${st.items.some((i) => !i.done) ? `<span class="k hp-type-mono">Still to do</span><ul class="recap">${st.items.filter((i) => !i.done).map((i) => `<li dir="auto">${esc(i.text)}</li>`).join('')}</ul>` : ''}
    <div class="row"><button class="btn btn-brand hp-type-action" type="button" id="again">Start again</button><button class="btn btn-secondary hp-type-action" type="button" id="close">Close</button></div>`;
  $('#score').classList.add('on');
  $('#again').onclick = () => void start(); $('#close').onclick = () => $('#score').classList.remove('on');
  track('session_end', { asked: st.asked, done, people: people.length });
}
$('#start').onclick = () => void start();
$('#end').onclick = () => void end();
$('#walk').onclick = () => void walk();
$('#tries').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { track('try_chip'); void send(b.textContent || ''); } });
$('#ckList').addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement; const k = Number(box.dataset.k); if (!st.items[k]) return;
  if (box.checked && k === st.walking && st.live) { void tick(k); return; }
  st.items[k].done = box.checked; showChecklist();
});
$('#ask').onsubmit = (e) => { e.preventDefault(); const q = $<HTMLInputElement>('#q'); const v = q.value; q.value = ''; void send(v); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#score').classList.remove('on'); });

// ---------- microphone ----------
let rec: MediaRecorder | null = null;
$('#mic').onclick = async () => {
  const mic = $('#mic');
  if (rec) { rec.stop(); return; }
  if (st.busy) return;
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { showSaid('Allow the microphone, or type.', false); return; }
  hush(); void getSeat();
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); rec = r;
  const parts: Blob[] = []; r.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize); let heard = false, quiet = performance.now(); const began = performance.now();
  const tick2 = window.setInterval(() => {
    an.getFloatTimeDomainData(buf); const rms = Math.sqrt(buf.reduce((n, x) => n + x * x, 0) / buf.length);
    if (rms > 0.02) { heard = true; quiet = performance.now(); }
    const now = performance.now();
    if ((heard && now - quiet > 1500) || now - began > 25000 || (!heard && now - began > 7000)) r.stop();
  }, 100);
  r.onstop = async () => {
    window.clearInterval(tick2); void ac.close(); stream.getTracks().forEach((t) => t.stop()); rec = null;
    mic.classList.remove('on'); mic.setAttribute('aria-pressed', 'false');
    if (!heard || !parts.length) { setState(st.live ? 'Your turn' : 'Ready'); return; }
    setState('Listening');
    const res = await fetch('api/hear', { method: 'POST', headers: { 'Content-Type': r.mimeType || 'audio/webm', 'x-lang': st.lang }, body: new Blob(parts, { type: r.mimeType || 'audio/webm' }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.text) { showSaid(d.error || "I didn't catch that. Try again, or type it.", false); setState(st.live ? 'Your turn' : 'Ready'); return; }
    void send(d.text);
  };
  r.start(250); mic.classList.add('on'); mic.setAttribute('aria-pressed', 'true'); setState('Listening');
};

// ---------- the handbook, the people and the checklist ----------
function useChecklist(text: string) { st.checklist = text; st.items = text.split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 10).map((t) => ({ text: t, done: false })); st.walking = -1; showChecklist(); }
function useHandbook(text: string, label = '') {
  st.handbook = text.trim().slice(0, 60000); st.own = !!st.handbook && st.handbook !== cfg?.sampleHandbook;
  st.company = st.own ? '' : cfg?.company || 'Tallyfield';
  $('#hbName').innerHTML = st.own ? `<b>Your handbook</b> · ${esc(label || `${st.handbook.length.toLocaleString()} characters`)}` : '<b>Tallyfield</b> · employee handbook (sample)';
  showTries(); track('handbook', { own: st.own });
}
const toggle = (id: string, focus: string) => { const box = $(id); box.hidden = !box.hidden; if (!box.hidden) $(focus).focus(); };
$('#hbBtn').onclick = () => toggle('#hbBox', '#hbText');
$('#pplBtn').onclick = () => toggle('#pplBox', '#pplText');
$('#ckBtn').onclick = () => toggle('#ckBox', '#ckText');
$('#hbText').addEventListener('change', () => useHandbook($<HTMLTextAreaElement>('#hbText').value || cfg?.sampleHandbook || ''));
$('#hbFile').addEventListener('change', async () => {
  const f = $<HTMLInputElement>('#hbFile').files?.[0]; if (!f) return;
  $('#hbNote').textContent = 'Reading the PDF…';
  try {
    const { pdfText } = await import('./pdf');
    const text = await pdfText(f);
    if (text.length < 200) throw new Error('This PDF has almost no text (it may be scanned). Paste the text instead.');
    $<HTMLTextAreaElement>('#hbText').value = text.slice(0, 60000); useHandbook(text, f.name.slice(0, 60));
    $('#hbNote').textContent = `Read ${f.name}: ${text.length.toLocaleString()} characters.${text.length > 60000 ? ' Only the first 60,000 are used.' : ''}`;
  } catch (e) { $('#hbNote').textContent = (e as Error).message || 'That PDF could not be read.'; }
});
// people as typed: name | role | about | contact; the sample adds an id and a photo, which are kept
const PEOPLE_HELP = (sample: string) => sample.split('\n').map((l) => l.split('|').map((x) => x.trim())).map((p) => [p[1], p[2], p[3], p[4]].join(' | ')).join('\n');
// a typed name that matches a sample colleague keeps that colleague's photo
const withPhotos = (typed: string, sample: string) => {
  const known = new Map(sample.split('\n').map((l) => l.split('|').map((x) => x.trim())).map((p) => [p[1].toLowerCase(), p]));
  return typed.split('\n').map((l) => { const p = l.split('|').map((x) => x.trim()); const k = known.get((p[0] || '').toLowerCase()); return p.length === 4 && k ? [k[0], ...p, k[5]].join(' | ') : l; }).join('\n');
};
$('#pplText').addEventListener('change', () => { const v = $<HTMLTextAreaElement>('#pplText').value.trim(); st.people = v ? withPhotos(v, cfg?.samplePeople || '') : cfg?.samplePeople || ''; showFaces(); track('people_edit'); });
$('#pplReset').onclick = () => { $<HTMLTextAreaElement>('#pplText').value = PEOPLE_HELP(cfg?.samplePeople || ''); st.people = cfg?.samplePeople || ''; showFaces(); };
$('#ckText').addEventListener('change', () => useChecklist($<HTMLTextAreaElement>('#ckText').value || cfg?.sampleChecklist || ''));
$('#ckReset').onclick = () => { $<HTMLTextAreaElement>('#ckText').value = cfg?.sampleChecklist || ''; useChecklist(cfg?.sampleChecklist || ''); };
$('#langs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b || b.dataset.lang === st.lang) return;
  st.lang = b.dataset.lang as Lang; $$('#langs button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.lang === st.lang)));
  document.querySelector('.subs')!.setAttribute('dir', st.lang === 'ar' ? 'rtl' : 'ltr'); $<HTMLInputElement>('#q').dir = st.lang === 'ar' ? 'rtl' : 'auto';
  showTries(); track('lang_pick', { lang: st.lang });
  if (st.live) void say(LINES[st.lang].hi(st.company));
});
$$<HTMLButtonElement>('.info-btn').forEach((b) => (b.onclick = () => { const box = document.getElementById(b.getAttribute('aria-controls')!)!; const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); box.hidden = !open; }));

// ---------- build it (only on the demo page): the download starts with the language ----------
$('#download')?.addEventListener('click', (e) => {
  (e.currentTarget as HTMLAnchorElement).href = `api/download?${new URLSearchParams({ lang: st.lang })}`;
  track('download', { lang: st.lang });
});
$('#deploy')?.addEventListener('click', () => track('deploy_click'));
$('#github')?.addEventListener('click', () => track('github_click'));

// ---------- start ----------
fetch('api/config').then((r) => r.json()).then(async (c) => {
  cfg = c; st.sessionSeconds = c.sessionSeconds === 0 ? 0 : Number(c.sessionSeconds) || SESSION_SECONDS;
  const q = new URLSearchParams(location.search).get('lang');
  const lang = (q && /^(en|es|zh|ar|fr)$/.test(q) ? q : c.choices?.lang) || 'en';
  if (lang !== 'en') document.querySelector<HTMLButtonElement>(`#langs [data-lang="${lang}"]`)?.click();
  st.people = c.people || c.samplePeople; $<HTMLTextAreaElement>('#pplText').value = c.people || PEOPLE_HELP(c.samplePeople); showFaces();
  $<HTMLTextAreaElement>('#ckText').value = c.checklist || c.sampleChecklist; useChecklist(c.checklist || c.sampleChecklist);
  if (c.handbook) $<HTMLTextAreaElement>('#hbText').value = c.handbook;
  useHandbook(c.handbook || c.sampleHandbook);
  clock(st.sessionSeconds || SESSION_SECONDS);
  drawable = await canDraw();
}).catch(() => { drawable = false; });
const report = () => parent !== window && parent.postMessage({ type: 'spatius-embed-height', demo: 'new-hire-onboarding', height: document.documentElement.scrollHeight }, '*');
new ResizeObserver(report).observe(document.body);
