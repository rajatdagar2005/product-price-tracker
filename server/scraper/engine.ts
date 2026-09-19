import { chromium, Browser, BrowserContext } from 'playwright';
import { ScrapeResult, ScrapeOptions } from './types';
import { validateObservation, sanitizeText } from './parser';

//  const DEFAULT_STORE_URL = (process.env.MOCK_STORE_URL || 'https://demo.inelabteamdev.com').trim().replace(/\/+$/, '');

const DEFAULT_STORE_URL = (
  process.env.MOCK_STORE_URL || 'https://demo.inelabteamdev.com'
).trim().replace(/\/+$/, '');

// Mutex locks to prevent concurrent duplicate scrapes for the same product
const activeScrapeLocks = new Set<number>();
let isCronBatchRunning = false;

export function isProductScraping(productId: number): boolean {
  return activeScrapeLocks.has(productId);
}

export function isCronRunning(): boolean {
  return isCronBatchRunning;
}

export function setCronRunning(running: boolean): void {
  isCronBatchRunning = running;
}

/**
 * Calculates exponential backoff delay with random jitter.
 */
export function calculateBackoffMs(attempt: number, baseMs = 1000, maxMs = 8000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  const jitter = Math.random() * (exp * 0.3); // 30% jitter
  return Math.round(exp + jitter);
}

/**
 * Scrapes a single product from the target storefront using Playwright.
 * Includes automated retries with exponential backoff and jitter.
 */
export async function scrapeProductWithRetry(
  productId: number,
  options: ScrapeOptions = {}
): Promise<ScrapeResult> {
  if (activeScrapeLocks.has(productId)) {
    return {
      productId,
      success: false,
      price: null,
      currency: 'INR',
      stock: null,
      isInStock: null,
      durationMs: 0,
      attemptsCount: 0,
      errorMessage: `Scrape already in progress for product ${productId} (lock prevented duplicate concurrent execution)`
    };
  }

  activeScrapeLocks.add(productId);
  const startTime = Date.now();
  const maxRetries = options.maxRetries ?? (parseInt(process.env.MAX_RETRIES || '3', 10) || 3);
  let lastError: string | null = null;
  let lastHttpStatus: number | null = null;
  let diagnostics: Record<string, unknown> = {};

  let browser: Browser | null = null;

  try {
    const isHeadless = options.headless ?? (process.env.HEADLESS !== 'false');
    browser = await chromium.launch({
      headless: isHeadless,
      slowMo: options.slowMo ?? 0,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const attemptStart = Date.now();
      let context: BrowserContext | null = null;

      try {
        context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });

        const singleResult = await scrapeSingleAttempt(context, productId, options.timeoutMs || 18000);
        lastHttpStatus = singleResult.httpStatus || 200;
        diagnostics = singleResult.diagnostics || {};

        if (singleResult.success && singleResult.parsed) {
          if (options.onAttempt) {
            await options.onAttempt(attempt, 'success');
          }
          return {
            productId,
            success: true,
            price: singleResult.parsed.price,
            currency: singleResult.parsed.currency,
            stock: singleResult.parsed.stock,
            isInStock: singleResult.parsed.isInStock,
            httpStatus: lastHttpStatus,
            durationMs: Date.now() - startTime,
            attemptsCount: attempt,
            diagnostics
          };
        }

        lastError = singleResult.error || 'Failed to extract valid price and stock';

        if (attempt < maxRetries) {
          if (options.onAttempt) {
            await options.onAttempt(attempt, 'retried', lastError || undefined);
          }
          const backoff = calculateBackoffMs(attempt);
          await new Promise(resolve => setTimeout(resolve, backoff));
        } else {
          if (options.onAttempt) {
            await options.onAttempt(attempt, 'failed', lastError || undefined);
          }
        }
      } catch (err: any) {
        lastError = err?.message || String(err);
        if (attempt < maxRetries) {
          if (options.onAttempt) {
            await options.onAttempt(attempt, 'retried', lastError || undefined);
          }
          const backoff = calculateBackoffMs(attempt);
          await new Promise(resolve => setTimeout(resolve, backoff));
        } else {
          if (options.onAttempt) {
            await options.onAttempt(attempt, 'failed', lastError || undefined);
          }
        }
      } finally {
        if (context) {
          await context.close().catch(() => {});
        }
      }
    }

    return {
      productId,
      success: false,
      price: null,
      currency: 'INR',
      stock: null,
      isInStock: null,
      httpStatus: lastHttpStatus,
      durationMs: Date.now() - startTime,
      attemptsCount: maxRetries,
      errorMessage: lastError,
      diagnostics
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    activeScrapeLocks.delete(productId);
  }
}

/**
 * Executes a single scrape attempt in an isolated browser context.
 */
async function scrapeSingleAttempt(
  context: BrowserContext,
  productId: number,
  timeoutMs: number
): Promise<{
  success: boolean;
  httpStatus?: number;
  parsed?: { price: number; currency: string; stock: number | null; isInStock: boolean | null };
  error?: string;
  diagnostics?: Record<string, unknown>;
}> {
  const page = await context.newPage();
  let interceptedHttpStatus: number | null = null;
  let interceptedPriceResponse: any = null;

  page.on('response', async res => {
    if (res.url().includes(`/product/${productId}`)) {
      interceptedHttpStatus = res.status();
    }
    if (res.url().includes(`/api/products/${productId}/price`)) {
      try {
        interceptedPriceResponse = await res.json();
      } catch {}
    }
  });

  const url = `${DEFAULT_STORE_URL}/product/${productId}`;

  try {
    const navResponse = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    if (navResponse) {
      interceptedHttpStatus = navResponse.status();
    }

    if (interceptedHttpStatus && interceptedHttpStatus >= 400) {
      return {
        success: false,
        httpStatus: interceptedHttpStatus,
        error: `HTTP error ${interceptedHttpStatus} when loading product page`,
        diagnostics: { url, httpStatus: interceptedHttpStatus }
      };
    }

    await page.waitForTimeout(600);

    // Locate price block
    const priceBlock = page.locator('.price-block, .product-pricing, [class*="price-block"]').first();
    const count = await priceBlock.count();

    if (count === 0) {
      // Diagnostic check: is the page a 404 or changed layout?
      const bodyText = await page.textContent('body').catch(() => '');
      return {
        success: false,
        httpStatus: interceptedHttpStatus || 200,
        error: 'Price block selector (.price-block) not found in DOM',
        diagnostics: {
          url,
          bodySnippet: bodyText ? bodyText.substring(0, 200).replace(/\s+/g, ' ') : '',
          pageTitle: await page.title().catch(() => '')
        }
      };
    }

    // Anti-bot bypass: Simulate realistic human hover with mouse movements over the price area
    // The mock store requires minMoves: 8 and minDwellMs: 600
    const box = await priceBlock.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      await page.mouse.move(cx - 40, cy);
      await page.waitForTimeout(80);

      for (let i = 0; i < 14; i++) {
        const x = cx - 40 + (i % 6) * 12;
        const y = cy - 8 + (i % 3) * 8;
        await page.mouse.move(x, y);
        await page.waitForTimeout(90);
      }
    }

    // // Check for "Reveal price" button and handle simulated click flake (Xn helper)
    // const revealBtn = page.locator('.price-block button, button:has-text("Reveal price")').first();
    // const btnCount = await revealBtn.count();

    // if (btnCount > 0) {
    //   for (let clickAttempt = 1; clickAttempt <= 4; clickAttempt++) {
    //     const isEnabled = await revealBtn.isEnabled().catch(() => false);
    //     if (isEnabled) {
    //       await revealBtn.click();
    //     }
    //     await page.waitForTimeout(800);

    //     // Check if price or spinner loaded
    //     const hasVisiblePrice = await page.locator('.pv-k2, [class*="pv-"]').count();
    //     const hasSpinner = await page.locator('.spinner, [aria-busy="true"]').count();
    //     if (hasVisiblePrice > 0 || hasSpinner > 0 || interceptedPriceResponse) {
    //       break;
    //     }
    //   }
    // }

    // Check for "Reveal price" button and handle simulated click flake
const revealBtn = page.locator(
  '.price-block button, button:has-text("Reveal price")'
).first();

const btnCount = await revealBtn.count();

if (btnCount > 0) {
  for (let clickAttempt = 1; clickAttempt <= 2; clickAttempt++) {
    try {
      const isVisible = await revealBtn.isVisible({ timeout: 1000 });
      const isEnabled = await revealBtn.isEnabled({ timeout: 1000 });

      if (isVisible && isEnabled) {
        await revealBtn.click({ timeout: 3000 });
      }
    } catch {
      // Reveal button may be flaky; continue polling for the price.
    }

    await page.waitForTimeout(800);

    const hasVisiblePrice = await page.evaluate(() => {
      const el = document.querySelector(
        '.pv-k2, [class*="pv-"]'
      ) as HTMLElement | null;

      if (!el) return false;

      const style = window.getComputedStyle(el);

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        Boolean((el.innerText || el.textContent || '').trim())
      );
    });

    const hasSpinner = await page.locator(
      '.spinner, [aria-busy="true"]'
    ).count();

    if (hasVisiblePrice || hasSpinner || interceptedPriceResponse) {
      break;
    }
  }
}

    // Wait for the visible price element to populate
    let visiblePriceText: string | null = null;
    let visibleStockText: string | null = null;

    for (let poll = 0; poll < 18; poll++) {
      await page.waitForTimeout(400);

      // Extract the REAL visible price:
      // Rejects hidden decoy elements (<span class="price-value" style="display: none">)
      visiblePriceText = await page.evaluate(() => {
        const el = document.querySelector('.pv-k2, [class*="pv-"]') as HTMLElement | null;
        if (!el) return null;
        // Verify element is not hidden
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return null;
        }
        return (el.innerText || el.textContent || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      });

      visibleStockText = await page.evaluate(() => {
        const el = document.querySelector('.stock-badge, .st-k2') as HTMLElement | null;
        if (!el) return null;
        return (el.innerText || el.textContent || '').trim();
      });

      if (visiblePriceText && visiblePriceText.length > 0) {
        break;
      }
    }

    if (!visiblePriceText) {
      // Collect diagnostics for failure
      const rawBlockText = await priceBlock.textContent().catch(() => '');
      return {
        success: false,
        httpStatus: interceptedHttpStatus || 200,
        error: 'Price failed to reveal (timeout waiting for .pv-k2)',
        diagnostics: {
          url,
          rawPriceBlockText: sanitizeText(rawBlockText),
          interceptedPricePayload: !!interceptedPriceResponse
        }
      };
    }

    const observation = validateObservation(visiblePriceText, visibleStockText);

    if (!observation.isValid || observation.price === null) {
      return {
        success: false,
        httpStatus: interceptedHttpStatus || 200,
        error: observation.validationError || 'Price validation failed',
        diagnostics: {
          rawPriceText: visiblePriceText,
          rawStockText: visibleStockText
        }
      };
    }

    return {
      success: true,
      httpStatus: interceptedHttpStatus || 200,
      parsed: {
        price: observation.price,
        currency: observation.currency,
        stock: observation.stock,
        isInStock: observation.isInStock
      },
      diagnostics: {
        rawPriceText: visiblePriceText,
        rawStockText: visibleStockText,
        engine: 'playwright-real-browser'
      }
    };
  } finally {
    await page.close().catch(() => {});
  }
}
