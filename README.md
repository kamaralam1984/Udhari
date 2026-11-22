# Maa Chandrakala Enterprises — AI Voice Calling MVP

AI voice calling console for payment follow-ups (Mock Mode). Next.js + TypeScript + Prisma + PostgreSQL.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, AUTH_JWT_SECRET, etc.
npm run db:up           # starts local Postgres via docker-compose.yml (matches the default DATABASE_URL)
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Sign in at `/login` with the seeded owner account (`SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` from `.env`).

## Scripts

- `npm run dev` / `npm run build` / `npm start`
- `npm test` — unit + integration tests (Vitest, against the real Postgres DB in `DATABASE_URL`)
- `npm run db:migrate` / `npm run db:seed` / `npm run db:studio`
- `npm run db:seed-demo` — optional ~30 days of fake calls/promises/collections so the Analytics page has data; `npm run db:seed-demo -- --clear` removes exactly what it created (everything is tagged `DEMO-` / `[DEMO]`)

## Notes

- All providers (telephony/STT/LLM/TTS/custom voice) default to `mock` — see `.env.example`. Swapping a vendor is an env var change, not a code change (`src/lib/providers/`).
- The app starts in `TEST` mode (Settings screen). `PRODUCTION` mode requires explicit owner activation and a real `TELEPHONY_PROVIDER`.
- The AI never creates a payment/received record — see `src/lib/callEngine/persist.ts`.

## Analytics, campaigns and alerts

- **`/analytics`** (neon dashboard): live/real-time charts, pick-up heatmap + "best time to call", call-flow diagram, provider map, staff leaderboard, interaction timeline, cost-vs-collection (ROI), customer payment-risk score, 7d/30d/custom date ranges with previous-period comparison, click-through drill-down on charts, live calls (polls every 4 s), and CSV / Excel / PDF exports. The view (tab, range, compare) is kept in the URL and in `localStorage`.
- **`/campaigns`**: a named batch of customers worked together. Start/pause/complete, one "Next call" click per member (TEST calls; PRODUCTION still needs production mode + the anti-spam gate). STAFF can see campaigns but not create or edit them.
- **Roles**: STAFF never receive money data from the analytics API (no collections, outstanding, ROI or other staff's rows) — enforced server-side in `src/app/api/analytics/`.
- **Alerts + daily report**: the 15-minute scheduler raises owner notifications (dashboard bell + WhatsApp channel) for a low call success rate, too many broken promises or a daily cost limit (each at most once per 6 h), and sends one end-of-day summary after `dailyReportHour`. Thresholds live in Settings → "Alerts & Daily Report"; `0` switches a rule off.
- **Best time to call (scheduler)**: Settings → Follow-up Automation → "Best time to call" (off by default). When on, an AI follow-up call that is due is held back while the current hour's pick-up rate is clearly below average (last 60 days of calls in the current mode), and placed in the next better hour outside quiet hours. It calls immediately with < 30 calls of history, and never waits longer than the configured max (default 24 h). Held calls stay `PENDING`, no attempt is consumed; the tick log shows `deferred(best time)`. Logic: `src/lib/followUp/bestTime.ts`.
- **Dark / Light mode**: toggle in the header. The first visit follows the OS setting; after that your choice is remembered (per browser) and applied before first paint. Every page, including `/analytics`, has a real light variant (see the `--*` tokens and `html[data-theme="light"]` in `src/app/globals.css`). All text is checked against WCAG AA contrast in both modes.
- **Notifications**: the bell in the header shows unread dashboard notifications (⚠ alerts are highlighted, daily report included). Click outside or press Esc to close, "Mark all read" clears everything (`PATCH /api/notifications` with `{ id }` or `{ all: true }`).
- **Accessibility / motion**: one visible keyboard focus ring everywhere, readable placeholders, 24 px minimum target for toggles, and `prefers-reduced-motion` switches off every animation (CSS and the SVG map).

## Real calls (Twilio + Bhashini)

`npm run dev` / `npm start` now boot a custom server (`server.ts`), not plain `next dev`/`next start` — this is required so a WebSocket can stay open for the life of each real call (Twilio Media Streams, mounted at `/ws/twilio-stream`). **This means the app can no longer be deployed to serverless hosting** (Vercel Functions, Lambda) — it needs an always-on Node host (VPS/Railway/Render/Fly/EC2-style).

Twilio is the active/tested telephony vendor (fast self-serve signup, no manual dashboard flow needed — the call-connect TwiML is generated inline per call by `src/lib/providers/telephony/twilio.ts`). An Exotel implementation also exists (`src/lib/providers/telephony/exotel.ts`) for when Exotel's business KYC clears, but it has no matching real-time audio bridge wired up yet — only Twilio's is.

To go live:

1. Sign up at twilio.com, buy a phone number, note the **Account SID** and **Auth Token** from the console.
2. Set in `.env`: `TELEPHONY_PROVIDER="twilio"`, `TELEPHONY_API_KEY=<Account SID>`, `TELEPHONY_API_SECRET=<Auth Token>`, `TELEPHONY_FROM_NUMBER=<your Twilio number>`, `TELEPHONY_WEBHOOK_BASE_URL=<public https base>`, `TWILIO_WEBHOOK_SECRET=<any random string>`.
3. Set `STT_PROVIDER="bhashini"` and `TTS_PROVIDER="bhashini"`, fill in `BHASHINI_*` vars (a bhashini.gov.in ULCA account). See `src/lib/providers/bhashiniPipeline.ts`.
4. **Language caveat**: `BHASHINI_LANGUAGE_CODE` defaults to `"hi"` (Hindi) on purpose. Magahi/Bhojpuri/Maithili (spoken in the Begusarai/Bihar target region) are not part of India's Eighth Schedule, and Bhashini's stable public model coverage isn't confirmed for them — before changing this default, call Bhashini's `getModelsPipeline` and check the language is actually listed. Hindi is a safe, working default: `src/lib/nlu/lexicon.ts` already compensates for Hindi-transliterated speech recognition of Magahi/Bhojpuri utterances at the text layer. If you confirm Bhashini has a Magahi ("mag") model for your pipeline, set `BHASHINI_MAGAHI_SUPPORTED="true"` to have `resolveBhashiniLanguageCode` (in `src/lib/providers/bhashiniPipeline.ts`) request it for Magahi/Begusarai customers instead of falling back to Hindi. The Magahi dialogue *text* (`src/lib/callEngine/dialogue.ts`) is used regardless of this flag — it only controls which voice model reads it.
5. `TELEPHONY_WEBHOOK_BASE_URL` must be a public HTTPS URL reachable by Twilio (a deployed domain, or `ngrok`/similar in dev) — it's used both for the call-status webhook (`/api/webhooks/twilio/status`) and to build the `wss://` Media Streams URL.
6. Flip `AppSettings.mode` to `PRODUCTION` from the Settings screen (owner-only) before placing real calls.

Everything about the conversation engine, the anti-spam gate, and the "AI never records a payment" invariant is unchanged in real-call mode — the audio bridge (`src/server/twilioStreamHandler.ts`) calls the exact same `advanceCallTurn` (`src/lib/callEngine/advanceTurn.ts`) that the mock-mode UI's typed-text flow uses.

Twilio's Media Streams JSON envelope, its Calls API, and its 8kHz mu-law audio encoding are Twilio's stable, well-documented protocol (implemented in `src/server/audioFraming.ts`) — higher confidence than the Exotel path. Bhashini's ULCA response field names are still best-effort based on generally documented shape — verify against Bhashini's current docs when wiring up a real account, and adjust `src/lib/providers/bhashiniPipeline.ts` if field names have moved.
