# Abide — Personal Daily Devotion PWA

A personal, offline-first Progressive Web App for daily Bible devotions. Built for iPhone and designed to be installed to the home screen. No accounts required — everything lives on your device.

**Live:** https://abidefaith.org
**Repo:** https://github.com/mattlmccoy/abide

---

## Features

- **Daily devotions** — AI-generated morning and evening sessions, 260+ words each, inspired by trusted teachers
- **Day navigation** — scroll back or forward across the week's plan
- **Save devotions** — bookmark any session to a personal library
- **Scripture lookup** — 7 Bible translations with intelligent autocomplete
- **Prayer list** — manage personal prayer requests
- **Daily journal** — date-keyed entries, never lost
- **Weekly plan builder** — AI-generates a full 7-day devotion plan from any topic
- **8 theme palettes** — frosted-glass cards, ambient backgrounds, dark mode
- **Push notifications** — optional morning and evening reminders (iOS 16.4+ PWA)
- **Google Drive sync** — optional backup/restore for devotions, journals, saved Bible chats, and settings
- **Streak tracking** — daily consistency counter
- **Fully offline** — Service Worker caches all assets; reads previously loaded scripture offline

---

## Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS (ES6, IIFEs), no build tools, no frameworks |
| Styling | CSS custom properties, glass morphism (`backdrop-filter`) |
| State | `localStorage` via Store module |
| Routing | Hash-based SPA router (`#/`, `#/scripture`, etc.) |
| Backend | Cloudflare Worker (ESV proxy, AI plan generation, push notifications) |
| Hosting | GitHub Pages (legacy mode, `main` branch root) |
| Bible | bible-api.com (free, CORS-enabled) + ESV via Worker |
| AI | Gemini → OpenRouter → Groq (automatic failover) |
| Sync | Google Drive (app data folder, OAuth 2.0) |

### Directory Structure

```
abide/
├── index.html                  # Single-page app shell
├── manifest.json               # PWA manifest
├── sw.js                       # Service Worker (caching + push)
├── offline.html                # Offline fallback page
├── CNAME                       # Custom domain: abidefaith.org
├── privacy.html
├── terms.html
│
├── css/
│   ├── app.css                 # CSS token system, layout, themes, 8 palettes
│   ├── components.css          # Cards, buttons, inputs, badges
│   ├── views.css               # Per-view styles (settings, devotion, plan, etc.)
│   └── animations.css          # Transition easing, keyframes
│
├── js/
│   ├── date.js                 # Date helpers, session detection, greeting
│   ├── store.js                # localStorage state management
│   ├── sync.js                 # Google Drive OAuth + sync
│   ├── api.js                  # Bible API, AI plan, push, phrase search
│   ├── router.js               # Hash-based SPA router
│   ├── notifications.js        # Push notification setup (iOS PWA)
│   ├── app.js                  # App entry point, route registration, boot
│   └── views/
│       ├── home.js             # Today's devotion, day navigation, save
│       ├── devotion.js         # Full devotion view, scripture hydration
│       ├── saved.js            # Saved devotionals library
│       ├── scripture.js        # Scripture lookup with translation picker
│       ├── prayer.js           # Prayer list management
│       ├── journal.js          # Daily journal entries
│       ├── plan.js             # Weekly plan builder (AI)
│       ├── settings.js         # App settings (pastors, theme, translation, etc.)
│       ├── settings-advanced.js # Usage stats, Worker URL, AI routing, Drive config
│       └── debug.js            # Diagnostic info, health checks, notification testing
│
├── worker/
│   ├── index.js                # Cloudflare Worker entry point + routing
│   ├── ai.js                   # AI plan generation + phrase search (multi-provider)
│   ├── bible.js                # ESV Bible API proxy
│   ├── search.js               # Serper.dev devotional search
│   ├── push.js                 # VAPID push notification delivery + cron
│   ├── wrangler.toml           # Cloudflare Worker config (KV, cron, AI binding)
│   └── README.md               # Worker setup guide
│
├── content/
│   └── seed/
│       └── week-1.json         # Default seed plan for first-time users
│
├── assets/
│   └── fonts/                  # Self-hosted WOFF2 fonts (offline fallback)
│       ├── playfair-display.woff2
│       └── inter.woff2
│
└── icons/                      # PWA icons (192px, 512px, maskable)
```

### Module Map

| File | Purpose |
|------|---------|
| `js/date.js` | `DateUtils` — date keys (`YYYY-MM-DD`), session detection (morning/evening), greetings, week calculations |
| `js/store.js` | `Store` — all app state in `localStorage`. Devotions, journal, plan, pastors, usage stats, Google Drive metadata |
| `js/sync.js` | `Sync` — Google OAuth 2.0 tokens, Drive folder/file management, multi-file sync (devotions, journals, settings) |
| `js/api.js` | `API` — Bible passage fetch, autocomplete suggestions, AI phrase search, AI plan build, push subscribe |
| `js/router.js` | `Router` — hash-based SPA routing, tab bar activation, view transitions, scroll-to-top |
| `js/notifications.js` | `Notifications` — iOS PWA detection, VAPID subscription, push permission flow, diagnostics |
| `js/app.js` | Boot sequence: theme init, palette restore, SW registration, route registration, streak check, seed plan load |

### Data Flow

```
User Interaction
      │
      ▼
  Router (hash change)
      │
      ▼
  View Module (.render())
      │
      ├──► Store (localStorage)     ← read/write app state
      │
      ├──► API.getPassage()         → bible-api.com (free, direct)
      │                             → Worker /bible (ESV, proxied)
      │
      ├──► API.buildAIPlan()        → Worker /ai/plan
      │                                    │
      │                             ┌──────┴──────┐
      │                         Gemini      OpenRouter / Groq
      │
      ├──► API.searchPhrase()       → Worker /ai/phrase → Cloudflare AI
      │
      └──► Sync (Google Drive)      → Google Drive API (app data folder)
```

---

## Getting Started (Local Dev)

No build tools required. Serve the repo root over HTTP:

```bash
# Python (built-in)
python3 -m http.server 8080

# Or use VS Code Live Server extension
```

Then open `http://localhost:8080` in your browser.

> **Note:** The Service Worker and some browser APIs require HTTPS in production. For local dev, `localhost` is treated as secure by all major browsers.

---

## Configuration

All configuration is done inside the app in **Settings**.

### Bible Translation

Choose from 7 translations: WEB (default), ESV, ASV, KJV, BBE, DARBY, NET.
ESV requires the Cloudflare Worker with an ESV API key — all other translations call bible-api.com directly.

### Trusted Pastors

Six teachers are enabled by default:

| Pastor | Known For |
|--------|-----------|
| Tim Keller | Redemptive theology, cultural engagement |
| John Mark Comer | Spiritual formation, Rule of Life |
| Jon Pokluda | Young adult discipleship, H2H church |
| Louie Giglio | Passion conferences, worship, cosmos |
| John Piper | Christian Hedonism, Desiring God |
| Ben Stuart | Breakaway Ministries, UT Austin |

Add or remove pastors in **Settings → Trusted Pastors**. The plan builder draws on the enabled list.

### Theme Palettes

8 palettes available in **Settings → Appearance**:

| Palette | Accent | Character |
|---------|--------|-----------|
| Tuscan Sunset | Terracotta | Warm, inviting (default) |
| Desert Dusk | Deep purple | Rich, contemplative |
| Lavender Fields | Soft violet | Light and serene |
| Cactus Flower | Sage green | Fresh and earthy |
| Mountain Mist | Teal | Cool and grounded |
| Graphite | Blue-grey | Minimal and focused |
| Ocean Glass | Sky blue | Open and clear |
| Mono | Grey | Maximum whitespace |

Dark mode is controlled separately (auto / light / dark) and respects system preference when set to auto.

### Push Notifications

Requirements: iOS 16.4+, app installed to home screen via Safari → Share → Add to Home Screen.
Configure morning and evening times in **Settings → Notifications**.

---

## Cloudflare Worker Setup

The Worker powers:
- **ESV Bible proxy** — keeps the ESV API key server-side
- **AI plan generation** — Gemini/OpenRouter/Groq for 7-day devotion plans
- **AI phrase search** — Cloudflare AI for finding relevant verses
- **Devotional search** — Serper.dev for pastor content
- **Push notifications** — VAPID delivery + 30-minute cron schedule

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed globally
- At minimum: a Gemini API key (free at [ai.google.dev](https://ai.google.dev))

### Deploy Steps

```bash
cd worker/

# 1. Login to Cloudflare
wrangler login

# 2. Create KV namespace (for caching)
wrangler kv namespace create ABIDE_KV
# Copy the returned id into wrangler.toml → kv_namespaces[].id

# 3. Set required secrets
wrangler secret put GEMINI_API_KEY          # Google Gemini
wrangler secret put VAPID_PUBLIC_KEY        # VAPID (generate below)
wrangler secret put VAPID_PRIVATE_KEY
wrangler secret put VAPID_SUBJECT           # e.g. mailto:you@example.com

# 4. Set optional secrets
wrangler secret put ESV_API_TOKEN           # ESV Bible (crossway.org, free)
wrangler secret put SERPER_API_KEY          # Serper.dev search (2,500/mo free)
wrangler secret put OPENROUTER_API_KEY      # OpenRouter fallback AI
wrangler secret put GROQ_API_KEY            # Groq fallback AI

# 5. Deploy
wrangler deploy
```

#### Generate VAPID Keys

```bash
npx web-push generate-vapid-keys
```

### Required Secrets

| Secret | Required | Source |
|--------|----------|--------|
| `GEMINI_API_KEY` | Yes (for AI) | [ai.google.dev](https://ai.google.dev) |
| `VAPID_PUBLIC_KEY` | Yes (for push) | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Yes (for push) | Same as above |
| `VAPID_SUBJECT` | Yes (for push) | `mailto:you@example.com` |
| `ESV_API_TOKEN` | For ESV translation | [api.esv.org](https://api.esv.org) |
| `SERPER_API_KEY` | For devotional search | [serper.dev](https://serper.dev) |

### Optional Secrets

| Secret | Purpose |
|--------|---------|
| `OPENROUTER_API_KEY` | Backup AI provider |
| `GROQ_API_KEY` | Backup AI provider |
| `GEMINI_MODEL` | Override default Gemini model |
| `GEMINI_PLAN_MODEL` | Override model used for plan generation |
| `OPENROUTER_MODEL` / `OPENROUTER_PLAN_MODEL` | OpenRouter model overrides |
| `GROQ_MODEL` / `GROQ_PLAN_MODEL` | Groq model overrides |
| `PLAN_AI_PROVIDER_ORDER` | Comma-separated provider order (e.g. `gemini,openrouter,groq`) |

### AI Provider Fallback Chain

```
handleAIPlan() request
       │
       ├─1st─► Gemini (Google)
       ├─2nd─► OpenRouter
       └─3rd─► Groq

Routing state is tracked in KV:
- Per-provider success rate, latency, 429 cooldowns
- Providers with recent failures are deprioritized automatically
```

### Worker API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/bible?ref=...&translation=...` | ESV Bible passage proxy |
| GET | `/search?topic=...&week=...` | Serper devotional search |
| POST | `/ai/plan` | Generate 7-day devotion plan |
| POST | `/ai/phrase` | Find verses for a search phrase |
| GET | `/ai/providers` | List configured AI providers |
| GET | `/ai/routing` | Provider health, scores, cooldowns |
| POST | `/ai/probe` | Probe all providers to update routing state |
| GET | `/ai/models` | List available Gemini models |
| POST | `/push/subscribe` | Register push subscription |
| POST | `/push/test` | Send a test push notification |

---

## Google Drive Sync

Google Drive sync is **opt-in** and backs up dedicated JSON files to a private `abidefaith-docs` folder in your Drive:

| Drive File | Contents |
|------------|----------|
| `abide-devotions.json` | Saved devotions library |
| `abide-journals.json` | All journal entries |
| `abide-ask-chats.json` | Saved Ask the Bible conversations |
| `abide-settings.json` | App settings + trusted pastor list |
| `abide-plan.json` | Current week plan |

### Setup

1. Go to **Settings → Advanced Settings → Google Drive**
2. Tap **Connect Google** and sign in
3. Use **Sync to Drive** / **Restore from Drive** to push or pull data

The Google OAuth Client ID is baked in. If you self-host, create your own at [console.cloud.google.com](https://console.cloud.google.com) and override it in Advanced Settings.

---

## Deployment

### GitHub Pages (Current Setup)

The app is served via **GitHub Pages legacy mode** — no build step, no GitHub Actions. GitHub Pages serves the `main` branch root directly.

Custom domain `abidefaith.org` is configured via the `CNAME` file at the repo root.

```bash
# Deploy is just a git push
git push origin main
```

### Service Worker Versioning

The SW version is hardcoded in `sw.js` and should be bumped on every pushed release:
```javascript
const SW_VERSION = 'v2026.03.13.1';
```

Bump this string whenever you push new changes so all clients receive a fresh cache. The activate handler automatically deletes old versioned caches.

The app version in `app.js` follows the scheme `YYYY.MM.DD.patch`:
```javascript
const APP_VERSION = '2026.02.20.4';
```

This is passed as a query param when registering the SW (`sw.js?v=...`) to force re-registration after updates.

---

## Privacy

- **Local-first:** All data (devotions, journal, settings, streak) lives in `localStorage` on your device. Nothing is sent to any server during normal use.
- **Bible API:** Scripture passages are fetched from [bible-api.com](https://bible-api.com) (public domain texts) or the Cloudflare Worker (ESV). No personal data is sent.
- **AI requests:** The plan topic you enter is sent to the Cloudflare Worker for AI processing. No identifying information is included.
- **Google Drive:** Only used when you explicitly connect. Data goes to your own Drive folder. The app cannot access any other Drive files.
- **No analytics, no tracking, no ads.**

See [privacy.html](privacy.html) for the full policy.

---

## Editorial Notes

### Bible Translation

Default translation is **World English Bible (WEB)** — public domain, modern English, free via bible-api.com with no API key. ESV is available via the Worker with a Crossway API token.

### Trusted Pastors

The default pastor list reflects non-denominational Protestant theology with an emphasis on spiritual formation, scripture engagement, and grace-centered preaching. Commentary that skews toward Christian Zionism or political theology is intentionally excluded.

### No Dependencies Policy

This project has zero npm dependencies, zero build tools, and zero frameworks. Every file is served as-is from the repo root. This keeps the app fast, auditable, and maintainable by a single developer.
