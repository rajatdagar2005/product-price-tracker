# Product Price Tracker (Web Scraping)

**INE Software Engineer Intern Assignment**  
**Candidate:** Rajat Dagar  
**Target Storefront:** [https://demo.inelabteamdev.com/](https://demo.inelabteamdev.com/)  
**Submission Deadline:** September 20, 2026, 11:59 PM IST  

---

## Overview

A full-stack, production-grade product price tracker designed to monitor price and stock changes on INE's mock storefront. Built with React, Node.js/Express, Supabase (PostgreSQL), Playwright, and external webhook scheduling via `cron-job.org`.

### Key Features
- **Accurate Product Search:** Live search across mock storefront products by partial or full name, brand, category, SKU, or ID.
- **Resilient Web Scraping Engine:** Reverse-engineered anti-bot bypass handling mouse movement dwell verification, click jitter drops (`Xn`), decoy honeypot filtering, and zero-width unicode space stripping.
- **Relational PostgreSQL Persistence:** Three normalized tables (`tracked_products`, `price_stock_history`, `scrape_attempts`) with automated audit logs and summary view.
- **Protected Cron Architecture:** Secured webhook endpoint (`/api/cron/scrape`) for `cron-job.org` with idempotency, overlap locks, and batch resilience.
- **Interactive Visualizations:** Recharts time-series charts displaying price trajectory, stock badges, and comprehensive scrape diagnostic logs.
- **Observable Headed Mode:** Standalone headed runner (`npm run scrape:headed`) for live screen-recording and evaluation.

---

## Architecture

```
┌─────────────────────────────────┐
│     cron-job.org (Every 2h)     │
└────────────────┬────────────────┘
                 │ HTTP POST (Bearer CRON_SECRET)
                 ▼
┌─────────────────────────────────────────────────────────┐
│       Node.js / Express Backend (Render / Cloud Run)     │
│  ├── /api/cron/scrape (Protected scheduled batch)       │
│  ├── /api/products/:id/scrape (Manual scrape)           │
│  ├── /api/products (Tracked products & summary)         │
│  └── /api/catalog/search (Mock store query proxy)       │
└────────────────┬───────────────────┬────────────────────┘
                 │                   │
    Playwright Browser Context       │ Database Queries
                 │                   │
                 ▼                   ▼
┌────────────────────────────────┐ ┌──────────────────────┐
│ INE Mock Storefront            │ │ Supabase PostgreSQL  │
│ (demo.inelabteamdev.com)       │ │ - tracked_products   │
│ - Physical Mouse Dwell         │ │ - price_stock_history│
│ - Decoy Honeypot Filtering     │ │ - scrape_attempts    │
│ - Zero-Width Space Stripping   │ └──────────────────────┘
└────────────────────────────────┘
```

---

## Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
npx playwright install chromium
```

### 2. Configure Environment (.env)
Copy `.env.example` to `.env`:
```bash
PORT=3000
NODE_ENV=development
MOCK_STORE_URL=https://demo.inelabteamdev.com
CRON_SECRET=ine_cron_secret_rajat_2026
HEADLESS=true
MAX_RETRIES=3
CONCURRENCY_LIMIT=2

# Optional: Add your Supabase credentials
# If left empty, the application uses an in-memory/local resilient fallback store.
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### 3. Initialize Database (Supabase)
Run the SQL script located in `database/schema.sql` inside your Supabase project's SQL Editor.

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Running the Observable (Headed) Scraper

To watch the browser navigate, hover over the price area, click Reveal, and extract the price live on screen (ideal for your interview screen recording):

```bash
npm run scrape:headed -- 550
```

---

## Automated Test Suite

Run the automated test suite verifying price parsing, zero-width stripping, decoy filtering, stock edge-cases, and backoff bounds:

```bash
npm test
```

---

## Setting Up Scheduled Cron (`cron-job.org`)

1. Go to [https://cron-job.org](https://cron-job.org) and create a free account.
2. Click **Create Cronjob**.
3. Set **Title**: `INE Product Price Tracker`.
4. Set **URL**: `https://<YOUR-RENDER-BACKEND-URL>/api/cron/scrape`
5. Set **Schedule**: Every 2 hours (`0 */2 * * *`).
6. Set **Request Method**: `POST` (or `GET`).
7. Add Request Header:
   - Key: `Authorization`
   - Value: `Bearer ine_cron_secret_rajat_2026`
8. Save and test the job.

---

## Production Deployment

### Backend (Render)
- Build Command: `npm install && npx playwright install chromium && npm run build`
- Start Command: `npm start`
- Environment Variables:
  - `PORT=3000`
  - `NODE_ENV=production`
  - `SUPABASE_URL=<your-supabase-url>`
  - `SUPABASE_SERVICE_ROLE_KEY=<your-supabase-key>`
  - `CRON_SECRET=ine_cron_secret_rajat_2026`

### Frontend (Vercel)
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`
