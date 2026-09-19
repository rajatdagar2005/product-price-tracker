import { Router, Request, Response } from 'express';
import {
  getTrackedProducts,
  getTrackedProductById,
  trackProduct,
  untrackProduct,
  getPriceHistory,
  getScrapeLogs,
  recordScrapeAttempt,
  recordSuccessfulObservation,
  isUsingSupabase,
  areSupabaseTablesReady,
  getSupabase
} from '../db';
import {
  scrapeProductWithRetry,
  isProductScraping,
  isCronRunning,
  setCronRunning
} from '../scraper/engine';
import { StoreCatalogItem } from '../../src/types';

export const apiRouter = Router();

//const STORE_BASE_URL = (process.env.MOCK_STORE_URL || 'https://demo.inelabteamdev.com').trim().replace(/\/+$/, '');
const STORE_BASE_URL = (
  process.env.MOCK_STORE_URL || 'https://demo.inelabteamdev.com'
).trim().replace(/\/+$/, '');
const CRON_SECRET = process.env.CRON_SECRET || 'ine_cron_secret_rajat_2026';

// In-memory catalog cache to make product searches instantaneous
let catalogCache: StoreCatalogItem[] = [];
let catalogCacheTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// new added line at 12:24 19 sep
let catalogLoadPromise: Promise<StoreCatalogItem[]> | null = null;

async function fetchStoreCatalog(): Promise<StoreCatalogItem[]> {
  const now = Date.now();

  // Return fresh cache immediately.
  if (
    catalogCache.length > 0 &&
    now - catalogCacheTime < CACHE_TTL_MS
  ) {
    return catalogCache;
  }

  // Prevent multiple searches from starting multiple catalog loads.
  if (catalogLoadPromise) {
    return catalogLoadPromise;
  }

  catalogLoadPromise = (async () => {
    const PAGE_SIZE = 60;
    const MAX_RETRIES = 4;
    const DELAY_BETWEEN_PAGES_MS = 500;
    const MAX_PASSES = 5;

    async function fetchPage(
      page: number,
      attempt = 1
    ): Promise<any | null> {
      try {
        const response = await fetch(
          `${STORE_BASE_URL}/api/catalog?page=${page}&pageSize=${PAGE_SIZE}`
        );

        if (response.ok) {
          return await response.json();
        }

        if (
          (response.status === 429 ||
            response.status === 500 ||
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504) &&
          attempt < MAX_RETRIES
        ) {
          const delay =
            response.status === 429
              ? 5000 * attempt
              : 2000 * attempt;

          console.warn(
            `[API] Catalog page ${page} returned ${response.status}. ` +
            `Retrying in ${delay}ms ` +
            `(attempt ${attempt + 1}/${MAX_RETRIES})`
          );

          await new Promise(resolve =>
            setTimeout(resolve, delay)
          );

          return fetchPage(page, attempt + 1);
        }

        console.warn(
          `[API] Catalog page ${page} failed: HTTP ${response.status}`
        );

        return null;
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          const delay = 2000 * attempt;

          console.warn(
            `[API] Catalog page ${page} request error. ` +
            `Retrying in ${delay}ms ` +
            `(attempt ${attempt + 1}/${MAX_RETRIES})`
          );

          await new Promise(resolve =>
            setTimeout(resolve, delay)
          );

          return fetchPage(page, attempt + 1);
        }

        console.error(
          `[API] Catalog page ${page} failed after ${MAX_RETRIES} attempts:`,
          error
        );

        return null;
      }
    }

    try {
      console.log('[API] Loading storefront catalog...');

      // First page determines total pages and expected product count.
      const firstData = await fetchPage(1);

      if (!firstData || !Array.isArray(firstData.items)) {
        throw new Error(
          'Unable to load the first catalog page'
        );
      }

      const totalPages = Number(firstData.pages) || 1;
      const expectedTotal =
        Number(firstData.total) || totalPages * PAGE_SIZE;

      console.log(
        `[API] Store catalog reports ${expectedTotal} products ` +
        `across ${totalPages} pages`
      );

      const itemMap = new Map<number, StoreCatalogItem>();

      const addItems = (data: any) => {
        if (!data || !Array.isArray(data.items)) {
          return 0;
        }

        let added = 0;

        for (const item of data.items) {
          if (item?.id == null) {
            continue;
          }

          const id = Number(item.id);

          if (!Number.isFinite(id)) {
            continue;
          }

          if (!itemMap.has(id)) {
            added++;
          }

          itemMap.set(id, {
            id,
            name: item.name,
            slug: item.slug,
            brand: item.brand || 'INE Store',
            category: item.category || 'General',
            sku: item.sku || `INE-${id}`,
            inStock: item.inStock ?? true,
            canonicalUrl: `${STORE_BASE_URL}/product/${id}`
          });
        }

        return added;
      };

      // Add first page.
      addItems(firstData);

      console.log(
        `[API] Catalog progress: 1/${totalPages} pages, ` +
        `${itemMap.size}/${expectedTotal} unique products`
      );

      /*
       * The storefront may shuffle products between requests.
       *
       * Therefore, one pass through pages 1..N may contain duplicates.
       * Repeat the pagination pass until:
       *
       *   1. We have the expected number of products, OR
       *   2. We reach MAX_PASSES.
       */
      for (
        let pass = 1;
        pass <= MAX_PASSES && itemMap.size < expectedTotal;
        pass++
      ) {
        console.log(
          `[API] Catalog pass ${pass}/${MAX_PASSES} starting...`
        );

        let newItemsThisPass = 0;

        // On pass 1, page 1 has already been loaded.
        // On later passes, fetch page 1 again because the catalog may shuffle.
        if (pass > 1) {
          const pageOneData = await fetchPage(1);

          if (pageOneData) {
            newItemsThisPass += addItems(pageOneData);
          }

          console.log(
            `[API] Catalog pass ${pass}: page 1, ` +
            `${itemMap.size}/${expectedTotal} unique products`
          );
        }

        for (let page = 2; page <= totalPages; page++) {
          // Stop immediately once we have the complete catalog.
          if (itemMap.size >= expectedTotal) {
            break;
          }

          const data = await fetchPage(page);

          if (data) {
            newItemsThisPass += addItems(data);
          }

          console.log(
            `[API] Catalog pass ${pass}: ` +
            `${page}/${totalPages} pages, ` +
            `${itemMap.size}/${expectedTotal} unique products`
          );

          if (page < totalPages) {
            await new Promise(resolve =>
              setTimeout(resolve, DELAY_BETWEEN_PAGES_MS)
            );
          }
        }

        console.log(
          `[API] Catalog pass ${pass} complete: ` +
          `${newItemsThisPass} new products found, ` +
          `${itemMap.size}/${expectedTotal} total`
        );

        // If an entire pass found nothing new, further passes are unlikely
        // to help and we can safely stop.
        if (newItemsThisPass === 0) {
          console.warn(
            `[API] Catalog pass ${pass} found no new products. ` +
            `Stopping catalog loading at ${itemMap.size}/${expectedTotal}.`
          );
          break;
        }
      }

      const items = Array.from(itemMap.values());

      console.log(
        `[API] Catalog loaded: ${items.length}/${expectedTotal} unique products`
      );

      if (items.length > 0) {
        catalogCache = items;
        catalogCacheTime = Date.now();

        console.log(
          `[API] Catalog cache refreshed: ${items.length} products`
        );
      }

      return catalogCache;
    } catch (error) {
      console.error(
        '[API] Failed to fetch catalog from store:',
        error
      );

      return catalogCache;
    } finally {
      catalogLoadPromise = null;
    }
  })();

  return catalogLoadPromise;
}

// async function fetchStoreCatalog(): Promise<StoreCatalogItem[]> {
//   const now = Date.now();

//   // Return fresh cache immediately.
//   if (
//     catalogCache.length > 0 &&
//     now - catalogCacheTime < CACHE_TTL_MS
//   ) {
//     return catalogCache;
//   }

//   // Prevent multiple searches from starting multiple catalog loads.
//   if (catalogLoadPromise) {
//     return catalogLoadPromise;
//   }

//   catalogLoadPromise = (async () => {
//     const PAGE_SIZE = 60;
//     const MAX_RETRIES = 4;
//     const DELAY_BETWEEN_PAGES_MS = 1000;

//     async function fetchPage(
//       page: number,
//       attempt = 1
//     ): Promise<any | null> {
//       try {
//         const response = await fetch(
//           `${STORE_BASE_URL}/api/catalog?page=${page}&pageSize=${PAGE_SIZE}`
//         );

//         if (response.ok) {
//           return await response.json();
//         }

//         if (
//           (response.status === 429 ||
//             response.status === 500 ||
//             response.status === 502 ||
//             response.status === 503 ||
//             response.status === 504) &&
//           attempt < MAX_RETRIES
//         ) {
//           const delay =
//             response.status === 429
//               ? 5000 * attempt
//               : 2000 * attempt;

//           console.warn(
//             `[API] Catalog page ${page} returned ${response.status}. ` +
//             `Retrying in ${delay}ms ` +
//             `(attempt ${attempt + 1}/${MAX_RETRIES})`
//           );

//           await new Promise(resolve =>
//             setTimeout(resolve, delay)
//           );

//           return fetchPage(page, attempt + 1);
//         }

//         console.warn(
//           `[API] Catalog page ${page} failed: HTTP ${response.status}`
//         );

//         return null;
//       } catch (error) {
//         if (attempt < MAX_RETRIES) {
//           const delay = 2000 * attempt;

//           console.warn(
//             `[API] Catalog page ${page} request error. ` +
//             `Retrying in ${delay}ms ` +
//             `(attempt ${attempt + 1}/${MAX_RETRIES})`
//           );

//           await new Promise(resolve =>
//             setTimeout(resolve, delay)
//           );

//           return fetchPage(page, attempt + 1);
//         }

//         console.error(
//           `[API] Catalog page ${page} failed after ${MAX_RETRIES} attempts:`,
//           error
//         );

//         return null;
//       }
//     }

//     try {
//       console.log('[API] Loading storefront catalog...');

//       // First page determines total pages.
//       const firstData = await fetchPage(1);

//       if (!firstData || !Array.isArray(firstData.items)) {
//         throw new Error(
//           'Unable to load the first catalog page'
//         );
//       }

//       const totalPages = Number(firstData.pages) || 1;
//       const expectedTotal =
//         Number(firstData.total) || totalPages * PAGE_SIZE;

//       console.log(
//         `[API] Store catalog reports ${expectedTotal} products ` +
//         `across ${totalPages} pages`
//       );

//       const itemMap = new Map<number, StoreCatalogItem>();

//       const addItems = (data: any) => {
//         if (!data || !Array.isArray(data.items)) {
//           return;
//         }

//         for (const item of data.items) {
//           if (item?.id == null) {
//             continue;
//           }

//           const id = Number(item.id);

//           if (!Number.isFinite(id)) {
//             continue;
//           }

//           itemMap.set(id, {
//             id,
//             name: item.name,
//             slug: item.slug,
//             brand: item.brand || 'INE Store',
//             category: item.category || 'General',
//             sku: item.sku || `INE-${id}`,
//             inStock: item.inStock ?? true,
//             canonicalUrl: `${STORE_BASE_URL}/product/${id}`
//           });
//         }
//       };

//       // Add first page.
//       addItems(firstData);

//       // Fetch remaining pages one at a time.
//       for (let page = 2; page <= totalPages; page++) {
//         const data = await fetchPage(page);

//         if (data) {
//           addItems(data);
//         }

//         console.log(
//           `[API] Catalog progress: ${page}/${totalPages} pages, ` +
//           `${itemMap.size} unique products`
//         );

//         if (page < totalPages) {
//           await new Promise(resolve =>
//             setTimeout(resolve, DELAY_BETWEEN_PAGES_MS)
//           );
//         }
//       }

//       const items = Array.from(itemMap.values());

//       console.log(
//         `[API] Catalog loaded: ${items.length}/${expectedTotal} unique products`
//       );

//       /*
//        * IMPORTANT:
//        *
//        * Don't throw away a useful partial catalog.
//        *
//        * The storefront appears to return a changing/shuffled catalog,
//        * so a complete 1000-product result is not guaranteed in one pass.
//        */
//       if (items.length > 0) {
//         catalogCache = items;
//         catalogCacheTime = Date.now();

//         console.log(
//           `[API] Catalog cache refreshed: ${items.length} products`
//         );
//       }

//       return catalogCache;
//     } catch (error) {
//       console.error(
//         '[API] Failed to fetch catalog from store:',
//         error
//       );

//       return catalogCache;
//     } finally {
//       catalogLoadPromise = null;
//     }
//   })();

//   return catalogLoadPromise;
// }

// async function fetchStoreCatalog(): Promise<StoreCatalogItem[]> {
//   const now = Date.now();
//   if (catalogCache.length > 0 && now - catalogCacheTime < CACHE_TTL_MS) {
//     return catalogCache;
//   }

//   try {
//     // Fetch pages of catalog from mock storefront
//     const items: StoreCatalogItem[] = [];
//     // Fetch up to 3 pages (60 products) for fast instant search
//     for (let page = 1; page <= 3; page++) {
//       const res = await fetch(`${STORE_BASE_URL}/api/catalog?page=${page}&pageSize=20`);
//       if (!res.ok) break;
//       const data = await res.json();
//       if (Array.isArray(data.items)) {
//         for (const item of data.items) {
//           items.push({
//             id: item.id,
//             name: item.name,
//             slug: item.slug,
//             brand: item.brand || 'INE Store',
//             category: item.category || 'General',
//             sku: item.sku || `INE-${item.id}`,
//             inStock: item.inStock ?? true,
//             canonicalUrl: `${STORE_BASE_URL}/product/${item.id}`
//           });
//         }
//       }
//       if (data.page >= data.pages) break;
//     }

//     if (items.length > 0) {
//       catalogCache = items;
//       catalogCacheTime = now;
//     }
//     return catalogCache;
//   } catch (err) {
//     console.error('[API] Failed to fetch catalog from store:', err);
//     return catalogCache;
//   }
// }

// ----------------------------------------------------------------------
// 1. Health check & Diagnostics
// ----------------------------------------------------------------------
apiRouter.get('/health', async (req: Request, res: Response) => {
  const usingSupabase = await isUsingSupabase();
  const tracked = await getTrackedProducts();
  const supabaseClient = getSupabase();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      type: usingSupabase ? 'supabase-postgresql' : 'in-memory-fallback',
      supabaseConfigured: !!supabaseClient,
      tablesReady: usingSupabase,
      connected: true,
      activeTrackedProducts: tracked.length
    },
    cron: {
      isCronRunning: isCronRunning(),
      cronSecretConfigured: !!process.env.CRON_SECRET
    },
    targetStoreUrl: STORE_BASE_URL
  });
});

// ----------------------------------------------------------------------
// 2. Search mock storefront catalog
// ----------------------------------------------------------------------
// apiRouter.get('/catalog/search', async (req: Request, res: Response) => {
//   const query = (req.query.q as string || '').toLowerCase().trim();
//   const catalog = await fetchStoreCatalog();

//   if (!query) {
//     return res.json({ items: catalog.slice(0, 20), total: catalog.length });
//   }

//   const filtered = catalog.filter(item =>
//     item.name.toLowerCase().includes(query) ||
//     item.brand?.toLowerCase().includes(query) ||
//     item.category?.toLowerCase().includes(query) ||
//     item.sku?.toLowerCase().includes(query) ||
//     String(item.id) === query
//   );

//   res.json({ items: filtered, total: filtered.length });
// });

apiRouter.get('/catalog/search', async (req: Request, res: Response) => {
  const query = String(req.query.q || '').toLowerCase().trim();

  if (!query) {
    return res.json({
      items: [],
      total: 0
    });
  }

  const catalog = await fetchStoreCatalog();

  const filtered = catalog
    .map(item => {
      const name = item.name?.toLowerCase() || '';
      const brand = item.brand?.toLowerCase() || '';
      const category = item.category?.toLowerCase() || '';
      const sku = item.sku?.toLowerCase() || '';
      const id = String(item.id);

      let score = 0;

      // Exact product ID.
      if (id === query) {
        score += 1000;
      }

      // Exact name.
      if (name === query) {
        score += 900;
      }

      // Name starts with query.
      if (name.startsWith(query)) {
        score += 700;
      }

      // SKU exact/prefix.
      if (sku === query) {
        score += 650;
      }

      if (sku.startsWith(query)) {
        score += 500;
      }

      // Brand starts with query.
      if (brand === query) {
        score += 450;
      }

      if (brand.startsWith(query)) {
        score += 350;
      }

      // Normal substring matches.
      if (name.includes(query)) {
        score += 300;
      }

      if (brand.includes(query)) {
        score += 200;
      }

      if (sku.includes(query)) {
        score += 150;
      }

      if (category.includes(query)) {
        score += 50;
      }

      return {
        item,
        score
      };
    })
    .filter(result => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.item.name.localeCompare(b.item.name);
    })
    .slice(0, 20)
    .map(result => result.item);

  res.json({
    items: filtered,
    total: filtered.length
  });
});

// ----------------------------------------------------------------------
// 3. Tracked products endpoints
// ----------------------------------------------------------------------
apiRouter.get('/products', async (req: Request, res: Response) => {
  const products = await getTrackedProducts();
  res.json({ products });
});

apiRouter.get('/products/:id', async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }

  const product = await getTrackedProductById(productId);
  if (!product) {
    return res.status(404).json({ error: 'Tracked product not found' });
  }

  res.json({ product });
});

apiRouter.post('/products/track', async (req: Request, res: Response) => {
  const { productId, name, slug, brand, category, sku, canonicalUrl } = req.body;

  if (!productId || !name) {
    return res.status(400).json({ error: 'productId and name are required' });
  }

  const tracked = await trackProduct({
    productId: Number(productId),
    name: String(name),
    slug,
    brand,
    category,
    sku,
    canonicalUrl: canonicalUrl || `${STORE_BASE_URL}/product/${productId}`
  });

  res.status(201).json({ product: tracked });
});

apiRouter.delete('/products/:id', async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }

  const success = await untrackProduct(productId);
  res.json({ success, message: `Product ${productId} untracked successfully` });
});

// ----------------------------------------------------------------------
// 4. History and Per-Product Scrape Logs
// ----------------------------------------------------------------------
apiRouter.get('/products/:id/history', async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }

  const limit = parseInt(req.query.limit as string || '100', 10);
  const history = await getPriceHistory(productId, limit);
  res.json({ history });
});

apiRouter.get('/products/:id/logs', async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }

  const limit = parseInt(req.query.limit as string || '50', 10);
  const logs = await getScrapeLogs(productId, limit);
  res.json({ logs });
});

// ----------------------------------------------------------------------
// 5. Manual Scrape Trigger (Single product)
// ----------------------------------------------------------------------
apiRouter.post('/products/:id/scrape', async (req: Request, res: Response) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId)) {
    return res.status(400).json({ error: 'Invalid product ID' });
  }

  if (isProductScraping(productId)) {
    return res.status(409).json({
      error: 'A scrape is already in progress for this product. Please wait for it to complete.'
    });
  }

  const product = await getTrackedProductById(productId);
  if (!product) {
    return res.status(404).json({ error: 'Product is not currently tracked' });
  }

  // const attemptLogs: Array<{ attemptNum: number; status: 'retried' | 'success' | 'failed'; error?: string }> = [];

  // const result = await scrapeProductWithRetry(productId, {
  //   onAttempt: async (attemptNum, status, error) => {
  //     attemptLogs.push({ attemptNum, status, error });
  //     await recordScrapeAttempt({
  //       productId,
  //       attemptNumber: attemptNum,
  //       status,
  //       durationMs: 0,
  //       errorMessage: error || null,
  //       diagnostics: { source: 'manual-trigger' }
  //     });
  //   }
  // });

  const attemptLogs: Array<{
  attemptNum: number;
  status: 'retried' | 'success' | 'failed';
  error?: string;
}> = [];

const result = await scrapeProductWithRetry(productId, {
  onAttempt: async (attemptNum, status, error) => {
    attemptLogs.push({ attemptNum, status, error });

    // Only intermediate retries are logged here.
    // The final success/failure is recorded below with the real duration.
    if (status === 'retried') {
      await recordScrapeAttempt({
        productId,
        attemptNumber: attemptNum,
        status: 'retried',
        durationMs: 0,
        errorMessage: error || null,
        diagnostics: { source: 'manual-trigger' }
      });
    }
  }
});

  // If scrape succeeded, record the observation in price_stock_history
  if (result.success && result.price !== null) {
    await recordSuccessfulObservation({
      productId,
      price: result.price,
      currency: result.currency,
      stock: result.stock,
      isInStock: result.isInStock
    });
  }

  // Update audit log with final duration
  await recordScrapeAttempt({
    productId,
    attemptNumber: result.attemptsCount,
    status: result.success ? 'success' : 'failed',
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    extractedPrice: result.price,
    extractedStock: result.stock,
    errorMessage: result.errorMessage || null,
    diagnostics: result.diagnostics
  });

  res.json({ result });
});

// ----------------------------------------------------------------------
// 6. Scheduled Cron Endpoint (Secured for cron-job.org)
// ----------------------------------------------------------------------
const handleCronScrape = async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // Validate security token
  if (token !== CRON_SECRET) {
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing Cron Bearer token',
      hint: 'Include header: Authorization: Bearer <CRON_SECRET>'
    });
  }

  // Prevent overlapping cron jobs
  if (isCronRunning()) {
    return res.status(409).json({
      error: 'A scheduled cron scrape batch is already in progress. Skipping duplicate run.'
    });
  }

  setCronRunning(true);
  const cronStart = Date.now();

  try {
    const products = await getTrackedProducts();
    const activeProducts = products.filter(p => p.is_active);

    const summary = {
      total: activeProducts.length,
      successCount: 0,
      failCount: 0,
      results: [] as Array<{ productId: number; success: boolean; price?: number | null; error?: string | null }>
    };

    // Process products sequentially or in batches of 2 to protect memory
    for (const prod of activeProducts) {
      try {
        const scrapeRes = await scrapeProductWithRetry(prod.product_id, {
          // onAttempt: async (attemptNum, status, error) => {
          //   await recordScrapeAttempt({
          //     productId: prod.product_id,
          //     attemptNumber: attemptNum,
          //     status,
          //     durationMs: 0,
          //     errorMessage: error || null,
          //     diagnostics: { source: 'cron-job.org' }
          //   });
          // }
          onAttempt: async (attemptNum, status, error) => {
          // Log intermediate retries here.
          // The final success/failure is recorded below with the real duration.
          if (status === 'retried') {
            await recordScrapeAttempt({
              productId: prod.product_id,
              attemptNumber: attemptNum,
              status: 'retried',
              durationMs: 0,
              errorMessage: error || null,
              diagnostics: { source: 'cron-job.org' }
            });
          }
        }
        });

        if (scrapeRes.success && scrapeRes.price !== null) {
          await recordSuccessfulObservation({
            productId: prod.product_id,
            price: scrapeRes.price,
            currency: scrapeRes.currency,
            stock: scrapeRes.stock,
            isInStock: scrapeRes.isInStock
          });
          summary.successCount++;
          summary.results.push({ productId: prod.product_id, success: true, price: scrapeRes.price });
        } else {
          summary.failCount++;
          summary.results.push({ productId: prod.product_id, success: false, error: scrapeRes.errorMessage });
        }

        // Record final attempt record
        await recordScrapeAttempt({
          productId: prod.product_id,
          attemptNumber: scrapeRes.attemptsCount,
          status: scrapeRes.success ? 'success' : 'failed',
          httpStatus: scrapeRes.httpStatus,
          durationMs: scrapeRes.durationMs,
          extractedPrice: scrapeRes.price,
          extractedStock: scrapeRes.stock,
          errorMessage: scrapeRes.errorMessage || null,
          diagnostics: scrapeRes.diagnostics
        });
      // } catch (err: any) {
      //   // Individual product failure MUST NOT halt the batch!
      //   summary.failCount++;
      //   summary.results.push({ productId: prod.product_id, success: false, error: err?.message || String(err) });
      // }
      
      } catch (err: any) {
  const errorMessage = err?.message || String(err);

  summary.failCount++;
  summary.results.push({
    productId: prod.product_id,
    success: false,
    error: errorMessage
  });

  // Record unexpected per-product errors too.
  try {
    await recordScrapeAttempt({
      productId: prod.product_id,
      attemptNumber: 0,
      status: 'failed',
      durationMs: 0,
      errorMessage,
      diagnostics: { source: 'cron-job.org', unexpectedError: true }
    });
  } catch (logErr) {
    console.error(
      `[CRON] Could not record unexpected failure for product ${prod.product_id}:`,
      logErr
    );
  }
}

    }

    res.json({
      message: 'Scheduled cron scrape completed',
      durationMs: Date.now() - cronStart,
      summary
    });
  } finally {
    setCronRunning(false);
  }
};

apiRouter.post('/cron/scrape', handleCronScrape);
apiRouter.get('/cron/scrape', handleCronScrape); // Support GET webhook if configured by cron-job.org
