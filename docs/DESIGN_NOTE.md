# Technical Design & Architecture Note
**Project:** Product Price Tracker (INE Software Engineer Intern Assignment)  
**Author:** Rajat Dagar  
**Target Storefront:** `https://demo.inelabteamdev.com/`  
**Date:** September 2026

---

## 1. Executive Summary

This document details the architectural decisions, reverse engineering findings, data modeling principles, and reliability mechanisms implemented for the Product Price Tracker system. The application monitors product prices and stock availability on INE's mock storefront on a fixed 2-hour schedule using an external cron scheduler (`cron-job.org`), stores time-series observations and audit logs in Supabase PostgreSQL, and surfaces trends through a modern React dashboard.

---

## 2. Scraping Strategy & Reverse Engineering Findings

### 2.1 The "HTTP vs. Real Browser" Decision
The project specification states:
> *"Prefer lightweight HTTP fetch + HTML parser if sufficient; use Playwright only if the storefront genuinely requires browser rendering. Explain why based on actual observed site behavior."*

**Verdict:** Playwright (real browser automation) is **strictly necessary** to extract prices and stock from `https://demo.inelabteamdev.com`.

### 2.2 Deep Investigation of Storefront Anti-Bot Defenses
Direct HTTP inspection of the storefront revealed sophisticated client-side challenges designed specifically to resist static scrapers:

1. **Client-Side Pricing & Session Token Exchange:**
   - The initial server response for `GET /product/:id` contains no price or stock figures in the raw HTML.
   - When the user visits the page, prices remain hidden behind a `.price-block` container with `phase: "idle"`.
   - The frontend JavaScript bundle (`assets/index-B9UiQq4X.js`) requires a signed session token obtained via `POST /api/tokens` with a payload containing:
     - A proof-of-work solution (`xr(salt, difficulty)`),
     - A WebAssembly computation (`Cr(wasmBlob, seed)`),
     - A client environment fingerprint (`cr(snapshot)`), which inspects canvas rendering, WebGL parameters, screen dimensions, and device pixel ratios.
   - Plain HTTP fetch requests (even with simulated signatures) fail with `challenge_failed` (403/401) because the challenge server validates the canvas fingerprint against real browser graphics pipelines.

2. **Physical Mouse Movement & Dwell Verification:**
   - The "Reveal price" button is initially disabled: `disabled={p !== null}`.
   - The internal tracker requires `minMoves: 8` and `minDwellMs: 600`.
   - Only after a cursor enters `.price-block`, moves across the bounding box at least 8 times, and dwells for >600ms does the button enable or trigger resolution.

3. **Simulated Click Flake (`Xn` Jitter Wrapper):**
   - The button `onClick` event is wrapped in an intentionally flaky handler `Xn`:
     ```js
     function Xn(e) {
       return () => {
         if (Math.random() < 0.35) {
           if (Math.random() < 0.5) return; // 17.5% drop rate
           window.setTimeout(e, 900);       // 17.5% delay
           return;
         }
         e();
       };
     }
     ```
   - A single click may be silently dropped by design. The scraper implements an active poll-and-click retry loop that detects whether the state transitioned away from `idle`.

4. **DOM Decoy Honeypots:**
   - The DOM injects hidden decoy elements:
     ```html
     <span class="price-value" aria-hidden="true" style="display: none;">₹9,328</span>
     <span class="amount" data-price="true" aria-hidden="true" style="display: none;">₹11,162</span>
     ```
   - Crude scrapers matching `.price-value` or `[data-price]` extract false decoy prices.
   - Our scraper evaluates computed styles (`window.getComputedStyle`) to ensure `display !== 'none'` and targets the true visual price container (`.pv-k2`).

5. **Zero-Width Unicode Splitting:**
   - Numbers are broken up with zero-width spaces (`\u200B`):
     ```html
     <div class="pv-k2"><span>₹</span><span>1​</span><span>3​</span><span>,​</span><span>8​</span><span>0​</span><span>5</span></div>
     ```
   - Our text sanitizer strips all zero-width unicode characters (`[\u200B-\u200D\uFEFF]`) before numeric parsing.

---

## 3. Database Schema & PostgreSQL Architecture

The schema in `database/schema.sql` adheres strictly to relational database normalization:

### 3.1 Three Core Tables
1. **`tracked_products`**:
   - Stores catalog metadata: `product_id`, `name`, `brand`, `category`, `sku`, `canonical_url`, `is_active`.
   - Enforces unique `product_id`.

2. **`price_stock_history`**:
   - Records **only** successful, validated observations.
   - Enforces `UNIQUE (product_id, observed_at)` for idempotency.
   - Accurately models stock:
     - `NULL`: stock not stated/unavailable.
     - `0`: explicitly out of stock.
     - Positive integer: verified units available.
     - **Never conflates missing stock with zero.**

3. **`scrape_attempts`**:
   - Immutable audit log of every scrape attempt and retry.
   - Status restricted to `CHECK (status IN ('success', 'retried', 'failed'))`.
   - Records `duration_ms`, `http_status`, `error_message`, and structured `diagnostics` JSONB.

### 3.2 View: `v_tracked_products_summary`
To eliminate N+1 queries when rendering the dashboard, a PostgreSQL view joins `tracked_products` with the latest record from `price_stock_history` and `scrape_attempts` using `LEFT JOIN LATERAL`.

---

## 4. Scheduling & Cron Architecture

### 4.1 Rejection of In-Process Schedulers
In-process schedulers (like `node-cron` or `setInterval`) fail in serverless or auto-sleeping container environments (Render free tier, Vercel, Cloud Run) because container sleep pauses timers.

### 4.2 External Webhook via `cron-job.org`
- Endpoint: `POST /api/cron/scrape` (also supports `GET`).
- Secured via HTTP Header: `Authorization: Bearer <CRON_SECRET>`.
- Scheduled for every 2 hours (`0 */2 * * *`).

### 4.3 Safe Concurrency & Overlap Prevention
- **Global Batch Lock (`isCronRunning`):** Prevents duplicate execution if a previous job is still running.
- **Product Mutex Lock (`activeScrapeLocks`):** Prevents concurrent duplicate scrapes for the same product.
- **Controlled Concurrency:** Free-tier containers have memory limits; products are scraped with limited concurrency (2 workers) rather than `Promise.all` spikes.
- **Batch Resilience:** If scraping product A fails, the loop records the failure in `scrape_attempts` and continues to product B without crashing the job.

---

## 5. Observable Headed Runner

For interview evaluation and video submission, `scripts/scrape-headed.cjs` provides a standalone runner:
```bash
npm run scrape:headed -- 550
```
- Launches Chromium with `headless: false` and `slowMo: 100`.
- Outputs step-by-step telemetry to stdout while the browser visually interacts with the page.
