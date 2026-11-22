// The brain of New hire onboarding: a first-week guide that answers only from your handbook and says who to ask.
// Plain functions with no network, no avatar and no web server, so you can copy this file
// into any app or agent (your own backend, a LiveKit or Agora agent) and keep the same behaviour.
//
//   sectionsOf(text)                    -> [{ id, title, text }]   the handbook cut into sections, in code
//   pickSections(sections, question)    -> the sections to send: all of a short handbook, else the best matches
//   peopleOf(text) / checklistOf(text)  -> the people list and the checklist, from simple lines of text
//   answerMessages(ob, ask)             -> messages for one answer: only from the sections, with the exact words used
//   readAnswer(raw, ob, sections)       -> { say, found, section, title, quote, person, why }   the quote is checked in code
//   isDone(text, lang)                  -> true when the new hire says "done" during the checklist
//   hearingHint(lang), voiceStyle(lang)
//
// An onboarding session (ob) is { lang, company, handbook, people: [{ id, name, role, about, contact, photo }], checklist }.

export const LANGS = { en: 'English', es: 'Spanish', zh: 'Chinese (Simplified)', ar: 'Arabic', fr: 'French' };
export const GUIDE = { name: 'Sofia', role: 'your onboarding guide' };

export const SAMPLE_COMPANY = 'Tallyfield';
export const SAMPLE_HANDBOOK = `## 1. Welcome to Tallyfield
Tallyfield makes online bookkeeping software for small accounting firms. This handbook is made up for practice. We are about 120 people, most of us in the Harbour Street office.

## 2. Working hours and working from home
Core hours are 10:00 to 16:00, when everyone should be reachable. You choose when to start and finish around them.
You may work from home up to 3 days a week once your manager agrees. In your first two weeks, please come to the office every day.

## 3. Time off
You have 25 days of holiday a year, plus public holidays. Book holidays in Peopleboard at least 2 weeks before.
If you are ill, tell your manager before 10:00 on the day. After 3 days of illness, we need a note from a doctor.

## 4. Payday and payslips
You are paid on the 25th of every month. If the 25th is on a weekend, you are paid on the Friday before.
Add your bank details in Peopleboard in your first week, or your first pay will be late. Your payslips are in Peopleboard too.

## 5. Expenses
Claim expenses in the expenses app within 30 days, with a photo of the receipt. Your manager approves them, and they are paid with your next salary.
Taxis are allowed after 21:00, or when you carry heavy equipment. When you travel for work, meals up to 30 euros a day are covered.

## 6. Laptops and accounts
IT gives you your laptop on your first day. Turn on two-step sign-in on your first day, before you use any customer data.
If you lose your laptop, tell IT within one hour. Do not install software that IT has not approved.

## 7. Security
Lock your screen whenever you leave your desk. Never share your password, not even with IT.
Report a suspicious email with the "Report" button in your mail app. Customer data stays in the systems we approve, never in personal email or personal cloud storage.

## 8. Benefits
Health insurance starts on your first day. Choose your plan in Peopleboard within 30 days.
Everyone has a learning budget of 1,000 euros a year for courses, books and conferences.

## 9. Your first week
You have a buddy for your first month: someone from another team who answers small questions. Your manager sends you a plan for your first week.
On Friday, your team has lunch together, paid by Tallyfield.`;

// Who does what. One person per line: id | name | role | what to ask them about | contact link | photo
export const SAMPLE_PEOPLE = `nadia | Nadia | IT support | laptops, accounts, two-step sign-in, software, passwords | https://chat.tallyfield.example/nadia | assets/ob/people/nadia.webp
victor | Victor | Finance | payday, payslips, bank details, expenses, receipts | https://chat.tallyfield.example/victor | assets/ob/people/victor.webp
grace | Grace | People team | holidays, illness, benefits, contracts, your manager, anything about your job | https://chat.tallyfield.example/grace | assets/ob/people/grace.webp
julian | Julian | Workplace | the office, desks, keys and access cards, parking, the kitchen | https://chat.tallyfield.example/julian | assets/ob/people/julian.webp`;

// The first-week checklist: one task per line.
export const SAMPLE_CHECKLIST = `Get your laptop and turn on two-step sign-in
Add your bank details for payday
Choose your health insurance plan
Read the security rules
Meet your buddy and your team`;

const HINTS = {
  en: 'A new employee asks about their first week at work: payday, holidays, expenses, laptops, benefits.',
  es: 'Una persona nueva pregunta por su primera semana de trabajo: nómina, vacaciones, gastos, portátil, beneficios.',
  zh: '新员工询问第一周的工作安排：发薪日、假期、报销、电脑、福利。',
  ar: 'موظف جديد يسأل عن أسبوعه الأول في العمل: يوم الراتب، الإجازات، المصاريف، الحاسوب، المزايا.',
  fr: "Une nouvelle recrue pose des questions sur sa première semaine : paie, congés, notes de frais, ordinateur, avantages.",
};
export const hearingHint = (lang) => HINTS[lang] || HINTS.en;
export const voiceStyle = (lang) => `Speak ${LANGS[lang] || 'English'} as a warm, upbeat colleague welcoming someone on their first week: clear, friendly, never like an assistant.`;

const L = (lang) => LANGS[lang] || 'English';
const parse = (raw) => { try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}; } catch { return {}; } };
const norm = (t) => String(t || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------- the handbook, cut into sections in code ----------
const HEADING = /^(#{1,4}\s+\S.*|\d+(\.\d+)*[.)]?\s+\S.{0,70}|[A-Z][^.!?:]{2,60}:?)$/;
/** Cut a handbook into sections at its headings ("## 4. Payday", "4. Payday", or a short title line). */
export function sectionsOf(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = []; let cur = null;
  const isHeading = (l, next) => {
    const t = l.trim();
    if (!t || t.length > 80) return false;
    if (/^#{1,4}\s/.test(t)) return true;
    // a numbered or short title line, followed by text, without a full stop at the end
    return HEADING.test(t) && !/[.!?;,]$/.test(t) && !!(next || '').trim() && (next || '').trim().length > t.length;
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isHeading(l, lines[i + 1])) { cur = { title: l.replace(/^#{1,4}\s+/, '').trim(), text: '' }; out.push(cur); continue; }
    if (!l.trim()) { if (cur) cur.text += '\n'; continue; }
    if (!cur) { cur = { title: 'Introduction', text: '' }; out.push(cur); }
    cur.text += `${l.trim()}\n`;
  }
  let sections = out.map((s) => ({ title: s.title.slice(0, 90), text: s.text.trim() })).filter((s) => s.text);
  // no headings found (for example a PDF with plain text): cut it into parts of about 1,200 characters
  if (sections.length < 2 && String(text || '').length > 1500) {
    sections = [];
    const paras = String(text).split(/\n\s*\n/); let buf = '';
    for (const p of paras) { if ((buf + p).length > 1200 && buf) { sections.push({ title: `Part ${sections.length + 1}`, text: buf.trim() }); buf = ''; } buf += `${p}\n\n`; }
    if (buf.trim()) sections.push({ title: `Part ${sections.length + 1}`, text: buf.trim() });
  }
  return sections.slice(0, 80).map((s, i) => ({ id: `s${i + 1}`, ...s, text: s.text.slice(0, 4000) }));
}

/** A short handbook is sent whole; a long one sends the sections that share the most words with the question. */
export function pickSections(sections, question, max = 12000) {
  const total = sections.reduce((n, s) => n + s.title.length + s.text.length, 0);
  if (total <= max) return sections;
  const words = new Set(norm(question).split(' ').filter((w) => w.length > 2).map((w) => w.replace(/s$/, '')));
  const score = (s) => {
    const t = norm(`${s.title} ${s.title} ${s.text}`).split(' ').map((w) => w.replace(/s$/, ''));
    return t.reduce((n, w) => n + (words.has(w) ? 1 : 0), 0) / Math.sqrt(t.length + 20);
  };
  const ranked = [...sections].sort((a, b) => score(b) - score(a));
  const out = []; let size = 0;
  for (const s of ranked) { if (size + s.text.length > max) break; out.push(s); size += s.text.length + s.title.length; }
  return out.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

const safeLink = (u) => (/^(https:\/\/|mailto:)[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
const safePhoto = (u) => (/^(assets\/[\w/.-]+\.(webp|png|jpe?g)|https:\/\/[^\s"'<>]+)$/i.test(String(u || '').trim()) ? String(u).trim() : '');
/** People from simple lines: id | name | role | what to ask them about | contact link | photo (the id and photo may be left out). */
export function peopleOf(text) {
  return String(text || '').split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p.length >= 3 && p.some(Boolean)).slice(0, 20).map((p, i) => {
    // with 6 parts the first is the id; otherwise the id is made from the name
    const [id, name, role, about, contact, photo] = p.length >= 6 ? p : [norm(p[0]).replace(/ /g, '-') || `p${i + 1}`, ...p];
    return { id: String(id).slice(0, 30) || `p${i + 1}`, name: String(name || '').slice(0, 40), role: String(role || '').slice(0, 60), about: String(about || '').slice(0, 200), contact: safeLink(contact), photo: safePhoto(photo) };
  }).filter((p) => p.name);
}
export const checklistOf = (text) => String(text || '').split('\n').map((l) => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 10).map((t) => t.slice(0, 120));

// ---------- one answer ----------
export function answerMessages(ob, ask) {
  const people = ob.people.map((p) => `- id "${p.id}": ${p.name}, ${p.role}. Ask about: ${p.about}`).join('\n') || '(no people list)';
  const step = ask.step ? `\nThis is a FIRST-WEEK TASK the new hire is working through: "${ask.step}". Explain briefly how to do it, from the handbook, and end by asking them to say "done" when it is done.` : '';
  return [{ role: 'system', content: `You are ${GUIDE.name}, the onboarding guide at ${ob.company || 'this company'}, talking to a new hire in their first week. Speak ${L(ob.lang)}, out loud, warmly, in 1 to 3 short sentences.
Answer ONLY from the HANDBOOK below. Never use general knowledge about companies or laws, and never guess a rule, a number or a date.
If the handbook does not answer the exact question, say so plainly (for example "The handbook doesn't say") and point them to the right person.
WHO DOES WHAT:
${people}
Pick a person when the question is about their area, or when the handbook does not answer it.${step}

Return JSON only:
{"found": true if the handbook answers the exact question, else false,
 "section": the id of the section the answer comes from (like "s4"), or "",
 "quote": the exact words from that section that answer it, copied character for character (at most 30 words), or "",
 "say": your spoken answer in ${L(ob.lang)},
 "person": the id of the person to ask, or "",
 "why": in ${L(ob.lang)}, 2 to 6 words that finish the sentence "Ask <name> ..." (for example "about parking" or "for your laptop"), or ""}

HANDBOOK:
${ask.sections.map((s) => `[${s.id}] ${s.title}\n${s.text}`).join('\n\n')}` },
  ...(ask.history || []).slice(-6).map((h) => ({ role: h.who === 'guide' ? 'assistant' : 'user', content: String(h.text || '').slice(0, 500) })),
  { role: 'user', content: String(ask.question || '').slice(0, 600) }];
}
/** True when the quoted words really are in the section (allowing small slips in copying). */
function inSection(quote, text) {
  const q = norm(quote), all = norm(text);
  if (!q) return false;
  if (all.includes(q)) return true;
  const words = q.split(' ').filter((w) => w.length > 2);
  const have = new Set(all.split(' '));
  return words.length >= 3 && words.filter((w) => have.has(w)).length / words.length >= 0.85;
}
const UNSURE = {
  en: "I'm not sure the handbook says that, so I won't guess.", es: 'No estoy segura de que el manual diga eso, así que no voy a adivinar.',
  zh: '我不确定手册里有这个内容，所以我不猜。', ar: 'لستُ متأكدة أن الدليل يذكر ذلك، لذلك لن أخمّن.', fr: "Je ne suis pas sûre que le manuel le dise, alors je préfère ne pas deviner.",
};
const ASK = { en: (n, w) => ` Please ask ${n}${w ? ` ${w}` : ''}.`, es: (n, w) => ` Pregunta a ${n}${w ? ` ${w}` : ''}.`, zh: (n, w) => ` 请问${n}${w ? `（${w}）` : ''}。`, ar: (n, w) => ` اسأل ${n}${w ? ` ${w}` : ''}.`, fr: (n, w) => ` Demande à ${n}${w ? ` ${w}` : ''}.` };
/**
 * The answer, checked in code: an answer that says it comes from the handbook must quote words that are really
 * in that section (or in another one). If not, the guide does not give it: she says she is not sure and names a person.
 */
export function readAnswer(raw, ob, sections) {
  const o = parse(raw);
  let section = sections.find((s) => s.id === o.section);
  let quote = String(o.quote || '').trim().slice(0, 300);
  if (quote && !(section && inSection(quote, section.text))) section = sections.find((s) => inSection(quote, s.text)); // the right words, another section
  const checked = !!(quote && section);
  let found = o.found === true && checked;
  const people = ob.people || [];
  let person = people.find((p) => p.id === o.person) || null;
  const why = String(o.why || '').trim().slice(0, 60);
  let say = String(o.say || '').trim().slice(0, 600);
  if (o.found === true && !checked) {
    // it claimed the handbook says so, but the words are not there: do not pass on a guess
    person ||= people.find((p) => /people|hr|human/i.test(p.role)) || people[0] || null;
    say = `${UNSURE[ob.lang] || UNSURE.en}${person ? (ASK[ob.lang] || ASK.en)(person.name, '') : ''}`;
    found = false; quote = '';
  }
  if (!found && !person) person = people.find((p) => /people|hr|human/i.test(p.role)) || null; // nobody named: the people team
  return { say: say || '…', found, section: found ? section.id : '', title: found ? section.title : '', quote: found ? quote : '', person: person ? person.id : '', why: person ? why : '' };
}

// ---------- the checklist: "done" in five languages, decided in code ----------
const DONE = {
  en: /^\s*(done|i'?m done|i did it|did it|finished|all done|ok(ay)?,? done|next|ready|yes,? (done|did it))\b/i,
  es: /^\s*(hecho|listo|lista|ya está|ya lo hice|terminado|terminé|siguiente)\b/i,
  zh: /^\s*(好了|完成了?|做完了?|搞定了?|下一个)/,
  ar: /^\s*(تم|انتهيت|خلصت|جاهز|جاهزة|التالي)/,
  fr: /^\s*(fait|c'est fait|terminé|fini|j'ai fini|suivant|c'est bon)\b/i,
};
export const isDone = (text, lang) => (DONE[lang] || DONE.en).test(String(text || '')) && !/[?？؟]/.test(String(text || '')) && String(text || '').trim().split(/\s+/).length <= 6;
