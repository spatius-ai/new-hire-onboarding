# New hire onboarding

## Overview

New hire onboarding is an avatar guide for a new employee's first week. The company gives it a handbook (pasted, or a PDF) and a short list of people. The new hire asks anything, out loud or typed: "when is payday?", "can I claim a taxi?". A live Spatius avatar, Sofia, answers only from the handbook, and the panel beside her shows the section and the exact words she used, highlighted.

The guide also walks the new hire through a first-week checklist. She explains each task from the handbook, and the new hire ticks it off with a click or by saying "done".

Its standout feature is **Who do I ask?**. When a question is about someone's area, or the handbook does not cover it, the guide introduces the right colleague from the people list, with their photo, role and a contact button: "The handbook doesn't say where to park. Please ask Julian from Workplace."

This repository is a small, complete template. It runs on your computer in a few minutes with only your Spatius API key and App ID. It is for HR and people teams, for HR tech and intranet products, and for developers who want an avatar that answers only from a document and shows its source.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/spatius-ai/new-hire-onboarding)

## Why this matters

New hires rarely read the whole handbook, are shy to ask basic questions, and do not yet know who does what. HR teams and managers answer the same first-week questions again and again. A guide that answers from the handbook, shows where it says so, and points to the right person, makes the first week calmer for both sides.

## User flow

1. The new hire keeps the sample (Tallyfield, a made-up company) or the company adds its own handbook, people and checklist.
2. They press "Start". Sofia greets them, and the 3-minute clock starts.
3. They ask by voice, by typing, or with a suggested question. Sofia answers in one to three sentences; the panel shows "From the handbook", the section, and the exact words highlighted.
4. If the handbook does not say, the panel shows "Not in the handbook", and Sofia says so instead of guessing.
5. When it is someone's job, a "Who do I ask?" card shows the colleague's photo, role, what to ask them and a message button.
6. "Walk me through my first week" explains each checklist task from the handbook; the new hire says "done" or ticks the box, and Sofia moves to the next task.
7. "End" shows a recap: questions answered, tasks done, the people to meet with their message links, and what is still to do.

## Architecture

```text
new-hire-onboarding/
  README.md
  LICENSE
  package.json
  vite.config.mjs           builds the web page and copies the avatar engine files
  wrangler.jsonc            Cloudflare Workers settings
  .env.example              settings for running on your computer
  .dev.vars.example         secrets for Cloudflare
  server/
    brain.mjs               the guide itself: sections, answers with checked quotes, who to ask, "done"
    app.mjs                 the API: session token, hearing, answers, voice (uses brain.mjs)
    node.mjs                runs the app on your computer
    worker.mjs              runs the app on Cloudflare Workers
  web/
    index.html              the page: the handbook, people and checklist, the guide and the panel
    src/main.ts             the session: questions, the source, the colleague card, the checklist, the microphone
    src/pdf.ts              reads a PDF handbook in the browser (pdf.js)
    src/onboarding.css      the look of the guide, the panel and the recap
    src/seat.ts             the Spatius avatar: load, connect, speak
    public/embed.js         puts the guide on any page with one line
    public/assets/          fonts, the guide's portrait, the colleagues' photos and the office picture
```

The code has three parts, so you can keep the part you need. `server/brain.mjs` is what makes it an onboarding guide; `server/app.mjs` connects it to OpenAI and the browser; `web/src/seat.ts` connects the avatar. The same `server/app.mjs` runs in both places.

**How answers stay inside the handbook.** `sectionsOf()` cuts the handbook into sections at its headings ("## 4. Payday", "4. Payday", or a short title line), in code. A short handbook is sent whole; for a long one, `pickSections()` sends the sections that share the most words with the question. `answerMessages()` asks the LLM for the answer, the section it comes from, and the exact words it used. `readAnswer()` then checks in code that those words really are in the handbook. If the LLM says the handbook answers the question but the words are not there, the guide does not pass the answer on: she says she is not sure, and names a person to ask. In our tests, every quote shown was really in the handbook, and every question the handbook does not cover got "the handbook doesn't say" and a person, never a guess.

**How "done" works.** During a checklist task, `isDone()` recognises "done", "listo", "好了", "تم", "c'est fait" and similar short replies in code, so ticking a task never waits for, or depends on, the LLM.

## Runtime modes

| Mode | Command |
| --- | --- |
| On your computer | `npm start` |
| Cloudflare Workers, local | `cp .dev.vars.example .dev.vars`, then `npm run dev:cf` |
| Cloudflare Workers, online | `npm run deploy` or the Deploy button |

**Starter minutes or your own OpenAI key.** Hearing, the answers and the voice use OpenAI. Without `OPENAI_API_KEY`, the guide uses free Spatius starter minutes (30 minutes per Spatius key), sent through `starter.spatius.app` with your Spatius key. When the minutes are used up, the page says so, and you add your own key. With `OPENAI_API_KEY` set, the guide calls OpenAI directly and the starter service is not used.

## Protocols and contracts

The browser talks to the server through five routes. An `onboarding` is `{ lang, company, handbook, people }`, with the handbook and people as text; the page keeps it and sends it with each question.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/config` | none | `appId`, `region`, `guide`, `choices`, `sessionSeconds`, `company`, your `handbook`, `people` and `checklist` if set, and the samples |
| `POST /api/session` | none | `appId`, `region`, `sessionToken` |
| `POST /api/hear` | Recorded audio as the body, header `x-lang` | `{ text }` |
| `POST /api/ask` | JSON `{ onboarding, question, step, history }` | `{ say, found, section, title, text, quote, person, why, who }`, or `{ done: true }` when `step` is set and the question means "done" |
| `POST /api/speak` | JSON `{ text, lang }` | The voice as raw PCM16, mono, 24 kHz, streamed |

`who` is the colleague's card, `{ name, role, about, contact, photo }`, or `null`. `text` is the full text of the section, so the page can highlight `quote` in it. Errors come back as `{ "error": "..." }` with a matching HTTP status. When starter minutes are used up, the status is 402 and `starterUsed` is `true`.

## Make it yours

- **Your handbook.** Paste it or upload a PDF on the page, or set `ONBOARDING_HANDBOOK` (and `ONBOARDING_COMPANY`) so it is there from the start. Clear headings help the guide name the section.
- **Your people.** One person per line: `name | role | what to ask them about | contact link`. Contact links must start with `https://` or `mailto:`. Set `ONBOARDING_PEOPLE`, or change `SAMPLE_PEOPLE` in `server/brain.mjs` (which also takes an id and a photo).
- **Your checklist.** One task per line, up to 10, in `ONBOARDING_CHECKLIST` or `SAMPLE_CHECKLIST`.
- **The guide.** Her face and voice are `FACE` in `server/app.mjs`; how she answers is `answerMessages()` in `server/brain.mjs`.
- **Session length.** Sessions last 3 minutes (`ONBOARDING_SECONDS`, or 0 for no limit).

## Use it in your own app

Pick the row that matches what you have.

| You have | Do this |
| --- | --- |
| Any website, intranet or web app, and you want the guide inside it | Deploy this template (Cloudflare button or your own server) with your handbook in the settings, then add one line where it should appear: `<script src="https://YOUR-ONBOARDING-ADDRESS/embed.js" data-lang="es" async></script>`. `data-lang` is optional. Events arrive on your page as `window` event `spatius:event`. |
| Your own backend, in any language | Copy `server/brain.mjs` (or port it: plain functions, no network). Cut the handbook once with `sectionsOf()`, then for each question call `pickSections()`, `answerMessages()` and `readAnswer()`. |
| Your own web page, and you want the avatar | Copy `web/src/seat.ts`. It loads a Spatius avatar into any element and plays 24 kHz PCM16 audio on it with lip sync. |
| A LiveKit or Agora voice agent | Start from Spatius's official example, [livekit-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/livekit-demo) or [agora-demo](https://github.com/spatius-ai/spatius-integration-demo/tree/main/agora-demo), then call `answerMessages()` / `readAnswer()` from your agent's LLM step, and send the source and the colleague card to your page as data messages. The brain is plain functions, so the guide works the same over LiveKit or Agora. |
| Another LLM, or an OpenAI-compatible gateway | Set `OPENAI_BASE_URL` with your own `OPENAI_API_KEY`. The brain works with any chat model that can return JSON. |

Spatius's official examples show how to connect an avatar (Direct, LiveKit, Agora, iOS, Android, Flutter): [spatius-integration-demo](https://github.com/spatius-ai/spatius-integration-demo), [livekit-plugins-spatius](https://github.com/spatius-ai/livekit-plugins-spatius) and [create-spatius-app](https://github.com/spatius-ai/create-spatius-app). This template shows what to build on top: the use case and its standout feature, in a brain you can plug into any of them.

## Technical stack

- Spatius avatar SDK (`@spatius/avatarkit`) in Direct mode, drawn in the browser
- OpenAI: `gpt-4o-mini-transcribe` (speech to text), `gpt-4.1-mini` (the answers, JSON replies), `gpt-4o-mini-tts` (voice); all can be changed in settings
- pdf.js (`pdfjs-dist`) to read PDF handbooks in the browser
- Vite for the web page, plain Node for the local server, Cloudflare Workers for hosting
- No database and no framework

## Setup and local development

You need Node 20.3 or newer and a Spatius account, for an API key and App ID from [app.spatius.ai](https://app.spatius.ai). You also need a browser with WebGPU or WebGL2, and a microphone if you want to speak.

```sh
git clone https://github.com/spatius-ai/new-hire-onboarding
cd new-hire-onboarding
cp .env.example .env      # paste SPATIUS_API_KEY and SPATIUS_APP_ID
npm install
npm start                 # open http://localhost:3000
```

The page calls `/api/...` and loads `/assets/...` on the same address as the page, so the page, the built files and the API must be served from one origin. `server/node.mjs` and Cloudflare both do this.

## Environment configuration

| Setting | Needed | What it does |
| --- | --- | --- |
| `SPATIUS_API_KEY` | Yes | Your Spatius API key |
| `SPATIUS_APP_ID` | Yes | Your Spatius App ID |
| `SPATIUS_REGION` | No | `us-west` (default) or your region |
| `OPENAI_API_KEY` | No | Your OpenAI key; without it, starter minutes are used |
| `OPENAI_BASE_URL` | No | Another OpenAI-compatible address for your own key. Your OpenAI key is never sent to the starter service. |
| `SPATIUS_STARTER_URL` | No | Another starter service address (for testing) |
| `ONBOARDING_LANG` | No | Starting language: `en`, `es`, `zh`, `ar` or `fr` |
| `ONBOARDING_COMPANY` | No | Your company's name, for the greeting |
| `ONBOARDING_HANDBOOK` | No | Your handbook, instead of the sample; write `\n` for a new line |
| `ONBOARDING_PEOPLE` | No | Your people list, one person per line, written with `\n` |
| `ONBOARDING_CHECKLIST` | No | Your first-week tasks, one per line, written with `\n` |
| `ONBOARDING_SECONDS` | No | Seconds per session, 180 by default; 0 for no limit |
| `OPENAI_CHAT_MODEL`, `OPENAI_STT_MODEL`, `OPENAI_TTS_MODEL` | No | Models |
| `PORT` | No | Local port, 3000 by default |

On Cloudflare, put the keys in `.dev.vars` (local) or as secrets (online); the other settings are in `wrangler.jsonc` under `vars`.

## Security and deployment guidance

- Keys stay on the server. The browser only receives a short-lived Spatius session token.
- The `/api` routes are open to anyone who can reach your site, and each question spends your OpenAI key or starter minutes and your Spatius minutes. The server allows 40 API requests per minute per visitor; for a public site, also turn on your host's rate limiting (for example Cloudflare rate limiting rules) and set a monthly limit in your OpenAI account.
- Nothing is stored on the server. The handbook, the people list and the questions live in the browser tab and are sent to the LLM provider only to answer. A PDF is read in the browser; only its text is sent. Recordings are turned into text and not kept.
- A real handbook and people list are company information: deploy the guide where only your staff can reach it (behind your intranet or single sign-on), not on a public page.
- Contact buttons only open the `https://` or `mailto:` link you give. The guide sends no messages and changes nothing in your HR systems.
- `.env` and `.dev.vars` are ignored by git. Never commit them.
- The avatar SDK sends basic performance data to Spatius so failures can be found. See the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/).

## License and use constraints

The code in this repository is under the MIT License (see `LICENSE`). The Spatius avatar SDK (`@spatius/avatarkit`) and the Spatius service are not part of this license; they are covered by the [Spatius Terms of Service](https://www.spatius.ai/terms-of-service/). pdf.js (`pdfjs-dist`) is under the Apache License 2.0. The fonts in `web/public/assets/fonts/` (Inter, Geist Mono, Space Grotesk) are under the SIL Open Font License; their license texts are in `web/public/assets/licenses/`. The office picture, the sample handbook, people and checklist, and the portraits are examples for this template.
