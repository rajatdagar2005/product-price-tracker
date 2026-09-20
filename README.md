# Product Price Tracker

A full-stack product price and stock tracker built for the INE Software Engineer Intern assignment. It searches products from the INE mock storefront, tracks selected products, scrapes price/stock information with Playwright, stores historical observations in Supabase PostgreSQL, records scrape attempts, and runs scheduled batch scraping.

## Table of Contents

- [Project Links](#project-links)
- [Overview](#overview)
- [Assignment Requirements](#assignment-requirements)
- [Architecture](#architecture)
- [Why Playwright?](#why-playwright)
- [Scraping Reliability](#scraping-reliability)
- [Correctness / Data Validation](#correctness--data-validation)
- [Scrape Lifecycle](#scrape-lifecycle)
- [Database / Persistence](#database--persistence)
- [API](#api)
- [Scheduled Scraping](#scheduled-scraping)
- [Frontend](#frontend)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [Headed Scraping Demonstration](#headed-scraping-demonstration)
- [Error Handling](#error-handling)
- [Trade-offs / Engineering Decisions](#trade-offs--engineering-decisions)
- [Project Structure](#project-structure)
- [Security / Configuration Notes](#security--configuration-notes)
- [Known Limitations](#known-limitations)
- [Assignment Completion Checklist](#assignment-completion-checklist)
- [AI-Assisted Development Note](#ai-assisted-development-note)

---

## Project Links

- **Live Application:** [https://product-price-tracker-weld.vercel.app/](https://product-price-tracker-weld.vercel.app/)
- **Backend API:** [https://product-price-tracker-zaqe.onrender.com/](https://product-price-tracker-zaqe.onrender.com/)
- **Mock Storefront:** [https://demo.inelabteamdev.com/](https://demo.inelabteamdev.com/)
- **GitHub Repository:** [https://github.com/rajatdagar2005/product-price-tracker](https://github.com/rajatdagar2005/product-price-tracker)
- **Headed Scraping Demo:** [https://drive.google.com/file/d/12DTtft6kOzpscmzs7C7VtLRgsFyKhI5s/view?usp=sharing](https://drive.google.com/file/d/12DTtft6kOzpscmzs7C7VtLRgsFyKhI5s/view?usp=sharing)

The demo video shows the real scraper (`server/scraper/engine.ts`) running in headed Chromium mode against the live mock storefront — the browser opening visibly, a slow or failing attempt, the retry/backoff behavior kicking in, and an eventual successful scrape. It is not a simulated or separately scripted demo; it is the same engine that powers the deployed application, run locally with `HEADLESS=false`.

---

## Overview

Typical workflow:

1. Search the storefront catalog by name, brand, category, SKU, or product ID.
2. Select a product from the search results.
3. Track the product, persisting it to the backend.
4. Trigger an immediate scrape, or allow the scheduled batch scrape to pick it up.
5. Playwright opens the product page in a real Chromium browser.
6. The scraper waits for the delayed/revealed price content to render.
7. Failed attempts are retried with exponential backoff and jitter, up to a configured maximum number of attempts.
8. Valid, validated price/stock observations are persisted to price history.
9. Every scrape attempt's outcome (success, retried, or failed) is recorded in a per-product log.
10. A bearer-token-protected cron endpoint scrapes all active tracked products in a single batch on an external schedule.

## Assignment Requirements

| Requirement | Implementation |
|---|---|
| Search products | `GET /api/catalog/search` (ranked matching on name/brand/category/SKU/ID) + `ProductSearch.tsx` |
| Track products | `POST /api/products/track` / `DELETE /api/products/:id`, persisted in `tracked_products` (Supabase, with in-memory fallback) |
| Scrape price/stock | Playwright-driven `scrapeProductWithRetry` in `server/scraper/engine.ts` |
| Scheduled scraping | `POST/GET /api/cron/scrape`, secured with `CRON_SECRET`, invoked by an external cron scheduler |
| Price/stock history | `price_stock_history` table, `GET /api/products/:id/history`, charted in `ProductDetailModal.tsx` |
| Scrape logs | `scrape_attempts` table, `GET /api/products/:id/logs`, listed in `ProductDetailModal.tsx` |
| Handle slow/error responses | Navigation timeout, HTTP status checks, bounded retries with exponential backoff + jitter |
| Correctness | Computed-style visibility checks reject hidden/decoy prices; `parser.ts` validates before persistence |
| Headed demonstration | Real engine run with `HEADLESS=false`; recorded in the linked demo video |

## Architecture

```text
React + Vite frontend (Vercel)
        |
        | HTTP API (VITE_API_BASE_URL)
        v
Node.js + Express backend (Render)
        |
        +--------------------+
        |                    |
        v                    v
 Supabase PostgreSQL     Playwright / Chromium
   (or in-memory              |
    fallback store)           v
                      INE Mock Storefront
                    (demo.inelabteamdev.com)

External Cron Scheduler (cron-job.org)
        |
        v
POST/GET /api/cron/scrape  (Bearer CRON_SECRET)
```

- **Vercel** hosts the built React/Vite frontend.
- **Render** hosts the Node.js/Express backend, which also runs Playwright/Chromium.
- **Supabase** provides PostgreSQL persistence; if it isn't configured, the backend transparently falls back to an in-memory store (`server/db.ts`) so the app still runs.
- **Playwright** performs the actual browser-based scraping of the mock storefront.
- **External cron** (a service such as cron-job.org) triggers the backend's scheduled batch-scrape endpoint on a fixed interval, rather than relying on an in-process timer.

## Why Playwright?

The mock storefront does not return price or stock in the initial HTML — the price area renders in an idle/hidden state and only becomes visible after client-side JavaScript runs and, per `docs/DESIGN_NOTE.md`, after genuine pointer interaction with the price block. The rendered price text is also split across DOM nodes interleaved with zero-width Unicode characters, and the page contains additional price-like elements hidden via CSS rather than absent from the markup.

A plain HTTP request and HTML parser cannot execute JavaScript, dispatch pointer events, or evaluate computed CSS, so it cannot reach or distinguish the real price. Playwright is used because:

- Pricing content is rendered/revealed dynamically, after page load.
- The scraper must wait for that client-side rendering to complete rather than trust the initial DOM.
- Extracted values are re-checked against the DOM's *computed* style (`display`, `visibility`, `opacity`) so hidden elements are not mistaken for the visible price.
- Interacting with the page — moving the mouse across the price block before checking for a reveal control — is part of how the visible price actually becomes available.
- HTTP response status is observed via Playwright's `page.on('response', ...)` and the navigation response, so a failed page load is distinguished from a rendering failure.
- Each retry attempt runs in its own isolated `BrowserContext`, so state from a failed attempt cannot leak into the next one.

This explanation is scoped to what this scraper actually does; it does not claim general anti-bot-evasion capability beyond the specific interaction and validation logic implemented in `server/scraper/engine.ts` and `server/scraper/parser.ts`.

## Scraping Reliability

All of the following is implemented in `server/scraper/engine.ts`.

### Timeouts

Page navigation uses `page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })`, where `timeoutMs` defaults to `18000` (18 seconds) and can be overridden via `options.timeoutMs`. A slow page load throws a Playwright timeout error rather than hanging indefinitely, which is caught and treated as a failed attempt eligible for retry.

### Retries

The scraper performs multiple total attempts (default configured by `MAX_RETRIES`) and retries failed attempts before returning a structured failure. Concretely, `maxRetries = options.maxRetries ?? (parseInt(process.env.MAX_RETRIES || '3', 10) || 3)` is the **total number of attempts** for a scrape, not additional retries on top of a first try — with the default of `3`, a scrape makes at most 3 attempts in total (1 initial attempt plus up to 2 retries) before it is recorded as `failed`.

### Exponential Backoff + Jitter

Between attempts (but not after the final one), the engine waits according to:

```ts
export function calculateBackoffMs(attempt: number, baseMs = 1000, maxMs = 8000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  const jitter = Math.random() * (exp * 0.3); // 30% jitter
  return Math.round(exp + jitter);
}
```

The base delay is `1000ms`, the delay doubles with each attempt, and it is capped at a maximum of `8000ms`. On top of that, up to 30% random jitter is added, so repeated scrapes of the same product do not retry in lockstep and a slow or rate-limited storefront isn't hit again immediately after a failure.

### Fresh Browser Context per Attempt

Each retry attempt opens a new `BrowserContext` (fixed viewport, desktop Chrome user agent) just before the attempt and closes it in a `finally` block immediately after, regardless of outcome. This means no cookies, cached state, or page handles carry over from a failed attempt into the next one — each attempt starts clean. The underlying `Browser` process itself is reused across attempts within a single scrape call and closed once the whole call finishes.

### Product-Level Locking

An in-process `Set<number>` (`activeScrapeLocks`) is used as a per-product mutex. If a scrape for a given `productId` is already running, a new call for that same product returns immediately with a "scrape already in progress" result instead of starting a second, overlapping scrape. The lock is acquired before the browser launches and released in the outer `finally` block.

### Batch Isolation

In `runBatchScrape` (`server/routes/api.ts`), each product is scraped inside its own `try/catch`. If scraping one product throws an unexpected error, it is caught, recorded as a `failed` scrape-attempt row, and the loop continues to the next product — one product's failure does not abort the rest of the batch.

### Batch Overlap Protection

A separate module-level flag (`isCronRunning` / `setCronRunning`) prevents two batch scrapes — whether triggered by the cron endpoint or the manual "scrape all" endpoint — from running concurrently. A new batch request while one is already running is rejected with `409 Conflict`.

## Correctness / Data Validation

Validation lives in `server/scraper/parser.ts` and governs what is allowed to become a persisted observation.

- **Sanitization:** `sanitizeText` strips zero-width spaces/joiners (`\u200B`–`\u200D`, `\uFEFF`) and non-breaking spaces before any numeric parsing, since the storefront's real price text is interleaved with zero-width characters.
- **Visible-only extraction:** in the scraper engine, the price is read from the DOM via `page.evaluate`, and the element is rejected if its computed style is `display: none`, `visibility: hidden`, or `opacity: 0` — this is what prevents the scraper from reading one of the page's hidden decoy price elements instead of the real, visible one.
- **Price validation:** `parsePrice` rejects an empty string, rejects anything that looks negative, and rejects the result unless it parses to a finite number greater than zero. There is no code path that invents, defaults, or guesses a price.
- **Stock parsing:** `parseStock` is handled independently of price — it distinguishes explicit "out of stock" text (`stock: 0, isInStock: false`) from a stated quantity, a generic "in stock" phrase with no count (`stock: null, isInStock: true`), and genuinely unstated stock (`stock: null, isInStock: null`). Missing stock information is never coerced to `0`.
- **HTTP errors:** a 4xx/5xx response on the product page navigation short-circuits the attempt as a failure with the HTTP status recorded, rather than proceeding to look for a price.
- **No fake history on failure:** a row is written to `price_stock_history` only when an attempt returns `success: true` with a non-null, validated price (`recordSuccessfulObservation` in `server/db.ts`). A failed attempt still produces a `scrape_attempts` row describing the failure, but never a `price_stock_history` row — the two tables serve different purposes:

  - **`price_stock_history`** stores only successful, validated price/stock observations.
  - **`scrape_attempts`** stores the outcome of every attempt — `success`, `retried`, or `failed` — including HTTP status, duration, and diagnostics.

## Scrape Lifecycle

```text
Request (manual trigger or batch/cron)
  ↓
Acquire product lock (activeScrapeLocks)
  ↓
Launch browser (Chromium, shared for this scrape call)
  ↓
Create fresh BrowserContext for this attempt
  ↓
Open product page (page.goto, 18s timeout)
  ↓
Check HTTP response status (4xx/5xx → fail this attempt)
  ↓
Locate price block; wait briefly for the page to settle
  ↓
Simulate mouse movement/dwell over the price block
  ↓
Click "Reveal price" if present, polling for a visible price/spinner
  ↓
Poll (up to 18x, 400ms apart) for a visible price element
  ↓
Parse price + stock (parser.ts)
  ↓
Validate observation (reject invalid/negative/empty price)
  ↓
Success → return result → persist to price_stock_history + scrape_attempts (success)
  ↓
Failure → close context → backoff (exponential + jitter) → fresh context → retry
  ↓
Retries exhausted → return structured failure → persist scrape_attempts (failed), no history row
  ↓
Release product lock; close browser
```

This matches the control flow in `scrapeProductWithRetry` and `scrapeSingleAttempt` in `server/scraper/engine.ts`.

## Database / Persistence

Implemented in `database/schema.sql` (Supabase/PostgreSQL), with an in-memory fallback in `server/db.ts` used automatically when Supabase credentials are not configured or the tables aren't reachable — the app still functions locally (with data reset on restart) without a database.

| Table / View | Stores |
|---|---|
| `tracked_products` | Products the user has chosen to track — ID, name, slug, brand, category, SKU, canonical URL, active flag, timestamps. |
| `price_stock_history` | One row per successful, validated scrape observation — price, currency, stock, in-stock flag, observed time. |
| `scrape_attempts` | One row per scrape attempt — status (`success`/`retried`/`failed`), HTTP status, duration, extracted price/stock, error message, diagnostics. |
| `v_tracked_products_summary` | A view joining each tracked product with its most recent history row and most recent scrape attempt, used to render the dashboard without extra per-product queries. |

Relationship: each tracked product has many history rows (only from successful scrapes) and many scrape-attempt rows (from every attempt, successful or not); the summary view exposes just the latest of each.

## API

All routes are mounted under `/api` in `server/routes/api.ts`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Service status, database mode (Supabase vs. in-memory), cron configuration presence, active tracked-product count. |
| `GET` | `/api/catalog/search?q=` | Ranked search of the mock storefront's catalog by name, brand, category, SKU, or ID. |
| `GET` | `/api/products` | List currently tracked (active) products with latest price/stock/attempt status. |
| `GET` | `/api/products/:id` | Fetch a single tracked product's summary. |
| `POST` | `/api/products/track` | Track a product (`productId`, `name` required; `slug`, `brand`, `category`, `sku`, `canonicalUrl` optional). |
| `DELETE` | `/api/products/:id` | Untrack a product (soft delete via `is_active = false`). |
| `GET` | `/api/products/:id/history?limit=` | Price/stock observation history for a product. |
| `GET` | `/api/products/:id/logs?limit=` | Scrape-attempt log for a product. |
| `POST` | `/api/products/:id/scrape` | Trigger an immediate, retried scrape of one product. |
| `POST` | `/api/products/scrape-all` | Trigger a sequential batch scrape of all active tracked products. |
| `POST` / `GET` | `/api/cron/scrape` | Bearer-token-protected batch scrape endpoint for the external cron scheduler. |

The cron endpoint requires `Authorization: Bearer <CRON_SECRET>` matching the server's `CRON_SECRET` environment variable; a missing or mismatched token returns `401 Unauthorized`. If a batch is already running, a new call (cron or manual) returns `409 Conflict`.

## Scheduled Scraping

The backend is deployed on Render, where a web service can spin down when idle — process-local timers do not reliably fire on a fixed wall-clock schedule under that model. So scheduled scraping is triggered externally rather than depending on a continuously running in-process scheduler.

```text
External Cron Scheduler
        ↓
GET/POST /api/cron/scrape
        ↓
Bearer secret validation (CRON_SECRET)
        ↓
Overlap check (isCronRunning)
        ↓
Batch scrape tracked products, one at a time
        ↓
Persist successful, validated observations (price_stock_history)
        ↓
Record scrape attempt outcomes (scrape_attempts)
```

The project's documentation (`docs/DESIGN_NOTE.md`) and setup notes describe this cron job as configured to run every 2 hours; the endpoint itself accepts a call at any interval the external scheduler is configured with — the 2-hour cadence is a configuration choice made on the scheduler side, not something enforced by the README or the backend code.

## Frontend

Implemented in `src/App.tsx` and `src/components/`:

- **Product search** (`ProductSearch.tsx`) — debounced search against `/api/catalog/search`, matching by name, brand, category, SKU, or ID.
- **Tracking products** — selecting a search result tracks it via `/api/products/track`; tracked products can be removed via `/api/products/:id`.
- **Current price and stock** (`ProductList.tsx`) — a dashboard of tracked products showing the latest known price, stock, and last scrape-attempt status.
- **Scrape actions** (`Header.tsx`, `ProductList.tsx`) — a per-product "scrape now" action and a "Check All Prices" batch action, both driven from the UI.
- **Historical price/stock data** (`ProductDetailModal.tsx`) — a Recharts line chart built from `/api/products/:id/history`.
- **Scrape logs** (`ProductDetailModal.tsx`) — a list of recent scrape attempts from `/api/products/:id/logs`, showing success/retried/failed outcomes with timing and error details.
- **Success/retry/failure visibility** — toast notifications surface the outcome of manual and batch scrape actions, and the scrape log view shows the same states over time.

## Local Development

**Prerequisites:** Node.js (20+ recommended) and npm.

```bash
git clone https://github.com/rajatdagar2005/product-price-tracker.git
cd product-price-tracker
```

Install dependencies:

```bash
npm install
```

Install the Playwright Chromium browser (required once, since Playwright does not bundle browser binaries):

```bash
npx playwright install chromium
```

Configure environment variables (see [Environment Variables](#environment-variables)) in a local `.env` file, then start the development server:

```bash
npm run dev
```

This runs `tsx server.ts`, which starts Express with Vite's middleware in SPA mode — the app is served from a single port. Open [http://localhost:3000](http://localhost:3000).

Optional production-style build and start, as defined in `package.json`:

```bash
npm run build
npm start
```

`npm run build` runs `vite build` for the frontend and bundles `server.ts` with esbuild into `dist/server.cjs`; `npm start` runs `node dist/server.cjs` (expects `NODE_ENV=production` to serve `dist/` statically).

Run the standalone headed scraper against a product ID:

```bash
npm run scrape:headed -- 550
```

Run the automated unit tests:

```bash
npm test
```

Type-check without emitting output:

```bash
npm run lint
```

There is a single `package.json` for the whole project — the frontend (Vite/React) and backend (Express) are built and run from the same repository rather than as separate packages.

## Environment Variables

No `.env.example` file is tracked in the repository, so the variables below are documented from what is actually read via `process.env` (`server.ts`, `server/db.ts`, `server/routes/api.ts`, `server/scraper/engine.ts`) and `import.meta.env` (frontend, Vite).

Backend:

```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=https://product-price-tracker-weld.vercel.app
MOCK_STORE_URL=https://demo.inelabteamdev.com
CRON_SECRET=<your-own-secret>
MAX_RETRIES=3
HEADLESS=true
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Frontend (Vite):

```env
VITE_API_BASE_URL=https://product-price-tracker-zaqe.onrender.com
```

| Variable | Purpose | Required |
|---|---|---|
| `PORT` | Port the Express server listens on. | No (defaults to `3000`) |
| `NODE_ENV` | When `production`, serves the built `dist/` frontend statically instead of Vite's dev middleware. | No |
| `FRONTEND_URL` | Origin allowed via CORS for `/api/*` requests. | No |
| `MOCK_STORE_URL` | Base URL of the storefront the catalog search and scraper target. | No (defaults to `https://demo.inelabteamdev.com`) |
| `CRON_SECRET` | Bearer token required by `/api/cron/scrape`. | Yes, to use the cron endpoint |
| `MAX_RETRIES` | Total scrape attempts (not additional retries) per scrape call. | No (defaults to `3`) |
| `HEADLESS` | Set to `false` to run Chromium in headed (visible) mode. | No (defaults to headless) |
| `SUPABASE_URL` | Supabase project URL. Without it, the app runs on the in-memory fallback store. | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key (`SUPABASE_KEY` or `VITE_SUPABASE_ANON_KEY` are accepted as fallbacks). | No |
| `VITE_API_BASE_URL` | Base URL the frontend prefixes onto all `/api/...` calls. | Yes, in production (frontend and backend are on different origins) |

Because Vite inlines any `VITE_`-prefixed variable into the client bundle at build time, nothing placed there is ever secret — `VITE_API_BASE_URL` is just the backend's public URL. `HEADLESS=false` is intended for local, visible scraping runs (including the demo recording); production should use the default headless setting.

## Headed Scraping Demonstration

**Video:** [https://drive.google.com/file/d/12DTtft6kOzpscmzs7C7VtLRgsFyKhI5s/view?usp=sharing](https://drive.google.com/file/d/12DTtft6kOzpscmzs7C7VtLRgsFyKhI5s/view?usp=sharing)

The recording was made by running the real application with `HEADLESS=false` and triggering a scrape through the application UI — it is the same `scrapeProductWithRetry` engine that runs in production, not a separate or simplified demo script. It shows:

- The Chromium browser opening visibly.
- An actual scrape attempt against the live mock storefront.
- A slow or failing attempt.
- The retry/backoff behavior taking over (a fresh browser context for the next attempt).
- An eventual successful scrape, with the result reflected in the application.

The repository also contains a standalone script, `scripts/scrape-headed.cjs` (run via `npm run scrape:headed`), which drives a simplified, single-pass, non-retrying version of the same navigate → reveal → poll flow for quick manual/debugging observation. It is a development utility, not the mechanism used for the demonstration video above.

## Error Handling

### Scraper (`server/scraper/engine.ts`, `parser.ts`)

- **Timeout:** navigation timeout (default 18s) throws and is caught as a failed attempt.
- **HTTP error:** a 4xx/5xx status on the product page short-circuits the attempt with the status recorded.
- **Missing price:** if the price element never becomes visible after polling, the attempt fails with diagnostics (raw block text, whether a price API response was intercepted).
- **Invalid price:** a price that fails `parsePrice`'s numeric/positivity checks is rejected even if something was extracted.
- **Delayed content:** the reveal-button click and price-polling loops account for the price rendering asynchronously rather than assuming it's present immediately after navigation.
- **Retry exhaustion:** once `maxRetries` attempts have all failed, `scrapeProductWithRetry` returns a structured `ScrapeResult` with `success: false` and the last error/diagnostics rather than throwing.

### Backend (`server/routes/api.ts`, `server/db.ts`)

- **Structured scrape result:** every route consuming the scraper reads a consistent `ScrapeResult` shape (`success`, `price`, `stock`, `httpStatus`, `durationMs`, `attemptsCount`, `errorMessage`, `diagnostics`).
- **Persistence errors:** Supabase calls in `server/db.ts` are wrapped in `try/catch`, falling back to the in-memory store so a database hiccup doesn't crash a request.
- **Batch isolation:** each product in `runBatchScrape` is scraped inside its own `try/catch`, so one product's unexpected error doesn't abort the batch.
- **Cron authentication:** `/api/cron/scrape` rejects requests without a matching `Authorization: Bearer <CRON_SECRET>` header (`401`).
- **Overlap protection:** concurrent batch runs (cron or manual) are rejected with `409` via the `isCronRunning` flag; concurrent scrapes of the same product are rejected via the per-product lock.

### Frontend (`src/App.tsx`, `src/components/`)

- **Loading states:** scrape-in-progress state (`activeScrapingId`, `isCronRunning`) disables/updates relevant buttons while a scrape runs.
- **Error states:** failed API calls are caught and surfaced via toast notifications rather than failing silently.
- **Scrape status/logs:** the product detail view lists recent scrape attempts with their status, so success, retry, and failure outcomes are all visible to the user, not just the latest result.

## Trade-offs / Engineering Decisions

- **Playwright instead of direct HTTP:** needed because price content is dynamically revealed/rendered and requires interaction — a static HTTP fetch has nothing to parse. This comes at the cost of a heavier, slower scrape (a full browser process) compared to a plain HTTP request.
- **Fresh browser context per retry:** improves isolation between attempts (no leaked cookies/state) at the cost of browser/context startup overhead on every retry.
- **External cron:** useful because the backend runs on a platform (Render, free tier) where an always-running in-process scheduler is not guaranteed to fire on schedule; the trade-off is an external dependency and one extra piece of infrastructure to configure.
- **Sequential batch scraping:** `runBatchScrape` processes tracked products one at a time rather than in parallel. This reduces peak memory/CPU load and simplifies per-product failure isolation and retry/backoff reasoning, at the cost of a longer total batch duration as the tracked-product list grows.
- **History only on validated success:** prevents failed or invalid observations from polluting the historical price series, at the cost of a gap in the chart for time windows where every attempt failed (rather than an interpolated or repeated value).

None of these choices is presented as universally optimal — they reflect the constraints of this assignment (a free-tier deployment, a single target storefront with reveal-gated pricing, and a scope limited to tracking/scraping/history/logs).

## Project Structure

```text
product-price-tracker/
├── server.ts                        # Express bootstrap: CORS, API mount, Vite middleware / static serving
├── server/
│   ├── db.ts                        # Supabase client + in-memory fallback repository
│   ├── routes/
│   │   └── api.ts                   # All /api routes: catalog search, tracked products, history,
│   │                                 #   logs, manual scrape, batch scrape, cron endpoint
│   └── scraper/
│       ├── engine.ts                # Playwright-driven scrape engine: retries, backoff, locks, cleanup
│       ├── parser.ts                # Price/stock text parsing and validation
│       └── types.ts                 # ScrapeResult / ScrapeOptions / ParsedPriceStock types
├── src/
│   ├── App.tsx                      # Top-level React app: state, data fetching, layout
│   ├── types.ts                     # Shared frontend TypeScript types
│   └── components/
│       ├── Header.tsx               # Status pill + "Check All Prices" trigger
│       ├── ProductSearch.tsx        # Debounced catalog search + tracking
│       ├── ProductList.tsx          # Tracked-product cards/table
│       └── ProductDetailModal.tsx   # Price history chart + scrape log for one product
├── database/
│   └── schema.sql                   # tracked_products / price_stock_history / scrape_attempts / view
├── scripts/
│   └── scrape-headed.cjs            # Standalone, single-pass headed scrape runner for observation
├── tests/
│   ├── parser.test.cjs              # Unit tests for price/stock parsing & validation
│   └── backoff.test.cjs             # Unit tests for backoff formula and lock semantics
├── docs/
│   └── DESIGN_NOTE.md                # Reverse-engineering notes on the storefront's price-reveal behavior
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Security / Configuration Notes

- The scheduled cron endpoint requires a bearer token matching `CRON_SECRET`; requests without a matching token are rejected with `401`.
- Secrets (`CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, etc.) are supplied only through environment variables; `.gitignore` excludes all `.env*` files, so no credentials are committed to the repository.
- Any variable prefixed `VITE_` (currently only `VITE_API_BASE_URL`) is compiled into the client-side bundle and is therefore public — no secret should ever be given that prefix.
- If a Supabase service-role key is used, it is read only on the server (`server/db.ts`) and never exposed to the frontend.
- Playwright is launched with `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`, flags commonly required to run Chromium inside a containerized hosting environment like Render.
- The scraper's target is configured via `MOCK_STORE_URL` and, in this deployment, always points at INE's mock storefront (`demo.inelabteamdev.com`) — no other site is scraped.

## Known Limitations

- The scraper's selectors and interaction sequence (price-block hover, reveal-button click, visible-price polling) are tailored to this specific mock storefront's markup and behavior, not a general-purpose scraper.
- Browser-based scraping is more resource-intensive (memory/CPU, startup time) than a direct HTTP request, which is an inherent cost of the approach described in [Why Playwright?](#why-playwright).
- Scheduled execution depends on an external cron service being configured and reachable; if it isn't, scraping only happens when triggered manually from the UI.
- Free-tier hosting (Render) can introduce cold starts, which add latency to the first request/scrape after a period of inactivity.
- Batch scraping is intentionally sequential rather than parallel, which keeps resource usage conservative on a free-tier backend but means overall batch duration grows linearly with the number of tracked products.

## Assignment Completion Checklist

- [x] Product search
- [x] Partial/full search support
- [x] Product tracking
- [x] Price scraping
- [x] Stock scraping
- [x] Scheduled scraping
- [x] Price/stock history
- [x] Per-product scrape logs
- [x] Retry handling
- [x] Slow/delayed response handling
- [x] Validation against invalid/hidden price data
- [x] Live deployment
- [x] Public GitHub repository
- [x] Headed scraping demonstration

## AI-Assisted Development Note

AI assistance was used during development for tasks such as debugging, implementation suggestions, documentation, and reviewing approaches — not as a substitute for testing the application against its real, deployed environment.

One concrete example: a production deployment issue occurred because the frontend used relative `/api/...` requests, which worked locally (frontend and backend served from the same origin) but broke once the frontend and backend were deployed separately on Vercel and Render — those relative requests resolved against the Vercel deployment itself instead of the Render API, so search, tracking, history, and logs all failed in production despite working locally. The implementation was corrected to use a configured `VITE_API_BASE_URL`, prefixing every API call with the actual backend URL, after which production API calls worked correctly. This reflects an ordinary debugging step surfaced by testing the real deployment topology, not a fundamental design flaw.
