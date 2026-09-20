# Technical Design & Architecture Note

**Project:** Product Price Tracker — INE Software Engineer Intern Assignment
**Author:** Rajat Dagar
**Date:** September 2026

## 1. Reliability Goals

The primary reliability goal is to keep price and stock tracking correct across repeated unattended scraping runs. The scraper must tolerate delayed content, slow or failed responses, dynamic DOM behavior, and temporary errors without silently storing incorrect data.

The design therefore separates scraping attempts from successful historical observations: failures remain visible in the scrape log, while only validated observations are added to price history.

## 2. Scraping Strategy

A lightweight HTTP/HTML approach was considered first, but the INE mock storefront requires browser-side behavior before the useful price information becomes available. The initial product response does not reliably expose the final visible price and stock information; the page also uses delayed rendering and user interaction around the price area.

Playwright was therefore selected because it provides a real Chromium environment capable of executing the storefront's JavaScript, interacting with the rendered DOM, and checking whether extracted elements are actually visible.

The scraper does not attempt to implement a general anti-bot bypass. Instead, it reproduces the browser interaction required by this particular mock storefront and validates the resulting observation before storing it.

## 3. Reliability & Retry Design

The scraper uses several layers of protection:

* **Timeouts and delayed content:** Page navigation has an explicit timeout. After navigation, the scraper waits and polls for the expected visible price instead of assuming that the value is immediately available.
* **Required interaction:** The scraper moves the mouse over the relevant price area and handles the storefront's price-reveal interaction before attempting extraction.
* **Visible-element validation:** Price extraction is restricted to elements that are actually visible. This prevents hidden price-like DOM elements from being mistaken for the displayed price.
* **Unicode sanitization:** Extracted text is normalized to remove zero-width Unicode characters and non-breaking spaces that can split or interfere with numeric parsing.
* **Price validation:** Parsed prices must be finite and positive. Invalid, empty, or non-positive observations are treated as scrape failures.
* **Stock parsing:** Stock information is parsed separately from price and distinguishes explicit out-of-stock, numeric quantity, generic in-stock, and unstated stock rather than treating missing stock as zero.
* **HTTP error handling:** Product page responses with error status codes are treated as failed attempts.
* **Retries:** Failed attempts are retried up to the configured total attempt budget. The default `MAX_RETRIES=3` therefore allows up to three total attempts.
* **Exponential backoff with jitter:** Retry delays increase exponentially, with a maximum delay and randomized jitter. This reduces the chance of immediately repeating the same transient failure.
* **Fresh browser context per attempt:** Each retry receives a new Playwright browser context. This isolates cookies, storage, and other browser state between attempts while allowing the browser process itself to be reused for the scrape operation.
* **Resource cleanup:** Pages and browser contexts are closed using cleanup logic even when an attempt fails.
* **Product-level locking:** An in-memory lock prevents duplicate concurrent scrapes of the same product within the backend process.
* **Batch overlap protection:** A batch-level lock prevents a second batch from starting while an existing batch is still running.
* **Batch failure isolation:** Products are processed sequentially and an individual product failure does not terminate the remaining batch. This favors predictable resource usage on the Render free-tier instance over maximum batch throughput.

## 4. Correctness & Data Integrity

The system intentionally separates successful observations from scrape attempts.

### `price_stock_history`

A record is created only after the scraper has successfully extracted and validated a price. Failed HTTP requests, timeouts, missing prices, and invalid observations do not create historical price records.

This prevents a failed scrape from appearing as a real price change in the history chart.

### `scrape_attempts`

Every relevant attempt outcome is recorded as `success`, `retried`, or `failed`, together with information such as timestamps, HTTP status where available, duration, errors, and diagnostics.

A retry therefore remains observable rather than being hidden from the user. If all allowed attempts fail, the final failure is logged and no false price observation is stored.

## 5. Scheduling & Deployment Trade-offs

The backend runs on Render, where free-tier instances can become idle or sleep. An in-process scheduler such as `setInterval` or `node-cron` cannot reliably provide an unattended two-hour schedule when the process is not continuously running.

The application therefore exposes a cron endpoint:

`POST /api/cron/scrape`

The endpoint is protected with a bearer `CRON_SECRET`, and an external scheduler such as cron-job.org invokes it every two hours.

The two-hour cadence is configured by the external scheduler rather than by an internal backend timer. The backend performs the batch when triggered, protects against overlapping batches, and continues processing when an individual product fails.

## 6. Database & Observability

Supabase PostgreSQL provides persistent storage for tracked products, historical price/stock observations, and scrape-attempt logs.

The main persistence model separates:

* `tracked_products` — products selected for tracking.
* `price_stock_history` — validated successful observations over time.
* `scrape_attempts` — the audit trail of scraping attempts and their outcomes.

This separation allows the dashboard to show a clean price history while still exposing failures and retries to the user.

## 7. Headed Run

The headed demonstration uses the application's normal scraping engine with `HEADLESS=false`. This means the submitted recording exercises the same `scrapeProductWithRetry` path used by the application rather than relying on a separate simulated workflow.

During the run, Chromium is visibly opened and the scraper performs the actual page interaction, including failure/slow-response handling, retry behavior, and eventual successful extraction.

A separate `scripts/scrape-headed.cjs` utility exists for development/debugging, but it is not presented as a replacement for the application's retry-based scraper used in the demonstration.

## 8. AI-Assisted Development: Initial Mistake & Correction

AI tools were used during implementation for debugging, code suggestions, and documentation, but all generated changes were tested against the actual application.

One concrete issue appeared after deployment. Initially, the React frontend used relative API paths such as `/api/products`. This worked during local development because the frontend and backend were effectively served together through the local development setup.

After deployment, the frontend ran on Vercel while the backend ran separately on Render. Relative requests therefore targeted the Vercel origin instead of the Render backend, causing production API requests to fail.

The issue was identified during production testing and corrected by configuring the frontend to use the `VITE_API_BASE_URL` environment variable pointing to the deployed backend. The production application was then retested, including product search, scraping, history, and logs.

This was an important example of why AI-generated implementation still needs to be validated in the actual deployment environment rather than assuming that code which works locally will behave identically in production.

## 9. Key Trade-offs

| Engineering Choice | Selected Approach                            | Trade-off / Rationale                                                                                                                               |
| ------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parsing engine     | Playwright                                   | Higher CPU/memory cost than HTTP parsing, but required for the storefront's browser-side rendering and interaction.                                 |
| Retry state        | Fresh browser context per attempt            | Adds some setup overhead, but isolates browser state between attempts and reduces cross-attempt contamination.                                      |
| Batch concurrency  | Sequential processing                        | Slower for large numbers of products, but reduces resource pressure and makes per-product failure isolation straightforward on a free-tier backend. |
| Scheduler          | External cron-job.org                        | Adds an external dependency, but works with a backend that may sleep and therefore cannot depend on an in-process timer.                            |
| Historical data    | Store only validated successful observations | Failed scrapes are excluded from price charts, preventing false data, while failures remain available in `scrape_attempts`.                         |

Overall, the design prioritizes **correctness, observability, and reliable unattended execution** over maximum scraping throughput or minimum browser overhead.
