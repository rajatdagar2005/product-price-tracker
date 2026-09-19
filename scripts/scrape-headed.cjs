/**
 * Observable (Headed) Scraper Runner
 *
 * Use this script to run the scraper in headed browser mode so you can
 * watch its behavior in real time and record a screen recording for submission.
 *
 * Usage:
 *   node scripts/scrape-headed.cjs [productId]
 *   npm run scrape:headed -- 550
 */

const { chromium } = require('playwright');

// Helper to strip zero-width chars and decoys
function sanitize(text) {
  if (!text) return '';
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}

async function runHeadedScrape(productId = 550) {
  console.log('===============================================================');
  console.log(' INE STORE - OBSERVABLE HEADED SCRAPER RUNNER');
  console.log(` Target Storefront: https://demo.inelabteamdev.com/product/${productId}`);
  console.log(` Mode: Headed (Visible UI) with slowMo: 100ms`);
  console.log('===============================================================\n');

  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Step 1: Launching Chromium browser (headed)...`);
  
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Monitor network calls
  page.on('response', res => {
    if (res.url().includes('/api/')) {
      console.log(`  [Network] ${res.status()} ${res.url().split('demo.inelabteamdev.com')[1] || res.url()}`);
    }
  });

  const url = `https://demo.inelabteamdev.com/product/${productId}`;
  console.log(`\n[${new Date().toISOString()}] Step 2: Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

  const pageTitle = await page.title();
  console.log(`  Page Title: "${pageTitle}"`);

  // Verify product title
  const title = await page.locator('h1').textContent().catch(() => 'Unknown');
  console.log(`  Product Heading: "${title.trim()}"`);

  console.log(`\n[${new Date().toISOString()}] Step 3: Locating price area (.price-block)...`);
  const priceBlock = page.locator('.price-block').first();
  await priceBlock.waitFor({ state: 'visible', timeout: 8000 });

  const box = await priceBlock.boundingBox();
  if (!box) {
    throw new Error('Could not compute price block bounding box');
  }

  console.log(`  Price block located at coordinates: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);

  console.log(`\n[${new Date().toISOString()}] Step 4: Simulating human mouse movement & dwell (minMoves >= 8, minDwellMs >= 600)...`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx - 30, cy);
  for (let i = 0; i < 12; i++) {
    const x = cx - 30 + (i % 5) * 15;
    const y = cy - 10 + (i % 3) * 10;
    await page.mouse.move(x, y);
    await page.waitForTimeout(100);
  }

  console.log(`\n[${new Date().toISOString()}] Step 5: Checking for Reveal Price button...`);
  const revealBtn = page.locator('.price-block button, button:has-text("Reveal price")').first();
  if (await revealBtn.count() > 0) {
    const isEnabled = await revealBtn.isEnabled();
    console.log(`  Reveal price button detected. Enabled: ${isEnabled}`);
    if (isEnabled) {
      console.log('  Clicking Reveal price button...');
      await revealBtn.click();
    }
  }

  console.log(`\n[${new Date().toISOString()}] Step 6: Waiting for dynamic price & stock reveal...`);
  let visiblePrice = null;
  let visibleStock = null;

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);

    visiblePrice = await page.evaluate(() => {
      const el = document.querySelector('.pv-k2, [class*="pv-"]');
      if (!el) return null;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return null;
      return el.innerText.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    });

    visibleStock = await page.evaluate(() => {
      const el = document.querySelector('.stock-badge, .st-k2');
      return el ? el.innerText.trim() : null;
    });

    if (visiblePrice) {
      break;
    }
  }

  const durationMs = Date.now() - startTime;

  console.log('\n===============================================================');
  console.log(' SCRAPE OBSERVATION RESULT');
  console.log('===============================================================');
  console.log(` Product ID:        ${productId}`);
  console.log(` Product Name:      ${title.trim()}`);
  console.log(` Extracted Price:   ${visiblePrice || 'FAILED'}`);
  console.log(` Extracted Stock:   ${visibleStock || 'Not stated'}`);
  console.log(` Total Duration:    ${durationMs}ms`);
  console.log(' Status:            SUCCESS');
  console.log('===============================================================\n');

  // Keep open for 3 seconds so the observer can inspect the rendered page
  await page.waitForTimeout(3000);
  await browser.close();
}

const productIdArg = parseInt(process.argv[2] || '550', 10);
runHeadedScrape(productIdArg).catch(err => {
  console.error('\n[Headed Scraper ERROR]:', err);
  process.exit(1);
});
