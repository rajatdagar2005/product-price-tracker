import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TrackedProduct, PriceStockObservation, ScrapeAttempt } from '../src/types';

// Supabase lazy client
let supabase: SupabaseClient | null = null;
let supabaseTablesReady: boolean | null = null;
let lastTableCheckTime = 0;
const TABLE_CHECK_INTERVAL_MS = 30000;

export function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL?.trim();
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  // Strip whitespace, internal spaces, and newlines that may be introduced during copy-paste
  const key = rawKey ? rawKey.trim().replace(/\s+/g, '') : '';

  if (url && key && url.startsWith('http')) {
    try {
      supabase = createClient(url, key, {
        auth: { persistSession: false }
      });
      console.log('[DB] Initialized Supabase client for:', url);
    } catch (err) {
      console.error('[DB] Failed to initialize Supabase client:', err);
      supabase = null;
    }
  }
  return supabase;
}

export async function areSupabaseTablesReady(): Promise<boolean> {
  const client = getSupabase();
  if (!client) return false;

  const now = Date.now();
  if (supabaseTablesReady !== null && now - lastTableCheckTime < TABLE_CHECK_INTERVAL_MS) {
    return supabaseTablesReady;
  }

  try {
    const { error } = await client.from('tracked_products').select('product_id').limit(1);
    // if (error) {
    //   if (supabaseTablesReady !== false) {
    //     console.info('[DB] Supabase connected, but schema tables are not initialized yet. Operating in resilient in-memory store.');
    //   }
    //   supabaseTablesReady = false;
    // } 
    if (error) {
      console.error('[DB] Supabase table check failed:', error);
      supabaseTablesReady = false;
    }
    else {
      if (supabaseTablesReady !== true) {
        console.log('[DB] Supabase PostgreSQL tables verified and active.');
      }
      supabaseTablesReady = true;
    }
  } catch {
    supabaseTablesReady = false;
  }

  lastTableCheckTime = now;
  return supabaseTablesReady;
}

// ----------------------------------------------------------------------
// In-Memory Fallback Store (Used when Supabase credentials are not set)
// ----------------------------------------------------------------------
class InMemoryStore {
  products: Map<number, TrackedProduct> = new Map();
  history: PriceStockObservation[] = [];
  attempts: ScrapeAttempt[] = [];
  historyIdCounter = 1;
  attemptIdCounter = 1;

  constructor() {
    this.seed();
  }

  private seed() {
    // Seed product 550 ("Helix Blender Two")
    const now = new Date();
    const product550: TrackedProduct = {
      product_id: 550,
      name: 'Helix Blender Two',
      brand: 'Helix',
      category: 'Home & Kitchen',
      sku: 'HLX-BLND-550',
      canonical_url: 'https://demo.inelabteamdev.com/product/550',
      is_active: true,
      created_at: new Date(now.getTime() - 86400000 * 3).toISOString(),
      updated_at: now.toISOString(),
      latest_price: 13805,
      latest_currency: 'INR',
      latest_stock: 62,
      latest_is_in_stock: true,
      latest_observed_at: new Date(now.getTime() - 7200000).toISOString(),
      latest_attempt_status: 'success',
      latest_attempt_duration_ms: 1820,
      latest_attempt_at: new Date(now.getTime() - 7200000).toISOString()
    };
    this.products.set(550, product550);

    // Initial historical price data points for product 550
    const points = [
      { hoursAgo: 72, price: 14200, stock: 75 },
      { hoursAgo: 48, price: 13950, stock: 70 },
      { hoursAgo: 24, price: 13805, stock: 65 },
      { hoursAgo: 2, price: 13805, stock: 62 }
    ];

    for (const pt of points) {
      const obsTime = new Date(now.getTime() - pt.hoursAgo * 3600000).toISOString();
      this.history.push({
        id: this.historyIdCounter++,
        product_id: 550,
        price: pt.price,
        currency: 'INR',
        stock: pt.stock,
        is_in_stock: true,
        observed_at: obsTime,
        created_at: obsTime
      });
    }

    // Initial audit logs for product 550
    this.attempts.push({
      id: this.attemptIdCounter++,
      product_id: 550,
      attempt_number: 1,
      status: 'success',
      http_status: 200,
      duration_ms: 1820,
      extracted_price: 13805,
      extracted_stock: 62,
      created_at: new Date(now.getTime() - 7200000).toISOString(),
      diagnostics: { engine: 'playwright-real-browser', resolvedVia: 'DOM: .pv-k2' }
    });
  }
}

const memoryStore = new InMemoryStore();

// ----------------------------------------------------------------------
// Repository API
// ----------------------------------------------------------------------

export async function isUsingSupabase(): Promise<boolean> {
  return areSupabaseTablesReady();
}

export async function getTrackedProducts(): Promise<TrackedProduct[]> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;

  if (client) {
    try {
      // First attempt querying the summary view
      const { data, error } = await client
        .from('v_tracked_products_summary')
        .select('*')
        .eq('is_active', true)
        .order('product_id', { ascending: true });

      if (!error && data && data.length > 0) {
        return data as TrackedProduct[];
      }

      // Fallback query directly on tracked_products if view is not created yet
      const { data: rawProducts, error: rawError } = await client
        .from('tracked_products')
        .select('*')
        .eq('is_active', true)
        .order('product_id', { ascending: true });

      if (!rawError && rawProducts) {
        return rawProducts as TrackedProduct[];
      }
    } catch {
      // Graceful fallback to memoryStore
    }
  }

  // Fallback to in-memory store
  return Array.from(memoryStore.products.values()).filter(p => p.is_active);
}

export async function getTrackedProductById(productId: number): Promise<TrackedProduct | null> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;

  if (client) {
    try {
      const { data, error } = await client
        .from('v_tracked_products_summary')
        .select('*')
        .eq('product_id', productId)
        .single();

      if (!error && data) return data as TrackedProduct;

      const { data: pData } = await client
        .from('tracked_products')
        .select('*')
        .eq('product_id', productId)
        .single();

      if (pData) return pData as TrackedProduct;
    } catch {
      // Graceful fallback
    }
  }

  return memoryStore.products.get(productId) || null;
}

export async function trackProduct(product: {
  productId: number;
  name: string;
  slug?: string;
  brand?: string;
  category?: string;
  sku?: string;
  canonicalUrl: string;
}): Promise<TrackedProduct> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;
  const now = new Date().toISOString();

  if (client) {
    try {
      const { data, error } = await client
        .from('tracked_products')
        .upsert({
          product_id: product.productId,
          name: product.name,
          slug: product.slug,
          brand: product.brand,
          category: product.category,
          sku: product.sku,
          canonical_url: product.canonicalUrl,
          is_active: true,
          updated_at: now
        })
        .select()
        .single();

      if (!error && data) {
        return data as TrackedProduct;
      }
    } catch {
      // Fall through to memory store
    }
  }

  const existing = memoryStore.products.get(product.productId);
  const tracked: TrackedProduct = {
    ...(existing || {}),
    product_id: product.productId,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    category: product.category,
    sku: product.sku,
    canonical_url: product.canonicalUrl,
    is_active: true,
    created_at: existing ? existing.created_at : now,
    updated_at: now
  };
  memoryStore.products.set(product.productId, tracked);
  return tracked;
}

export async function untrackProduct(productId: number): Promise<boolean> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;

  if (client) {
    try {
      const { error } = await client
        .from('tracked_products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('product_id', productId);

      if (!error) return true;
    } catch {
      // Fall through to memory store
    }
  }

  const p = memoryStore.products.get(productId);
  if (p) {
    p.is_active = false;
    p.updated_at = new Date().toISOString();
    return true;
  }
  return false;
}

export async function getPriceHistory(productId: number, limit = 100): Promise<PriceStockObservation[]> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;

  if (client) {
    try {
      const { data, error } = await client
        .from('price_stock_history')
        .select('*')
        .eq('product_id', productId)
        .order('observed_at', { ascending: true })
        .limit(limit);

      if (!error && data) return data as PriceStockObservation[];
    } catch {
      // Fall through to memory store
    }
  }

  return memoryStore.history
    .filter(h => h.product_id === productId)
    .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime())
    .slice(-limit);
}

export async function getScrapeLogs(productId: number, limit = 50): Promise<ScrapeAttempt[]> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;

  if (client) {
    try {
      const { data, error } = await client
        .from('scrape_attempts')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data) return data as ScrapeAttempt[];
    } catch {
      // Fall through to memory store
    }
  }

  return memoryStore.attempts
    .filter(a => a.product_id === productId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}

export async function recordScrapeAttempt(attempt: {
  productId: number;
  attemptNumber: number;
  status: 'success' | 'retried' | 'failed';
  httpStatus?: number | null;
  durationMs: number;
  extractedPrice?: number | null;
  extractedStock?: number | null;
  errorMessage?: string | null;
  diagnostics?: Record<string, unknown>;
}): Promise<void> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;
  const now = new Date().toISOString();

  if (client) {
    try {
      await client.from('scrape_attempts').insert({
        product_id: attempt.productId,
        attempt_number: attempt.attemptNumber,
        status: attempt.status,
        http_status: attempt.httpStatus,
        duration_ms: attempt.durationMs,
        extracted_price: attempt.extractedPrice,
        extracted_stock: attempt.extractedStock,
        error_message: attempt.errorMessage,
        diagnostics: attempt.diagnostics || {},
        created_at: now
      });
    } catch {
      // Non-fatal
    }
  }

  // Always update in-memory cache as well
  const record: ScrapeAttempt = {
    id: memoryStore.attemptIdCounter++,
    product_id: attempt.productId,
    attempt_number: attempt.attemptNumber,
    status: attempt.status,
    http_status: attempt.httpStatus,
    duration_ms: attempt.durationMs,
    extracted_price: attempt.extractedPrice,
    extracted_stock: attempt.extractedStock,
    error_message: attempt.errorMessage,
    diagnostics: attempt.diagnostics,
    created_at: now
  };
  memoryStore.attempts.unshift(record);

  // Update product summary fields
  const p = memoryStore.products.get(attempt.productId);
  if (p) {
    p.latest_attempt_status = attempt.status;
    p.latest_attempt_duration_ms = attempt.durationMs;
    p.latest_attempt_error = attempt.errorMessage || null;
    p.latest_attempt_at = now;
  }
}

export async function recordSuccessfulObservation(observation: {
  productId: number;
  price: number;
  currency?: string;
  stock: number | null;
  isInStock: boolean | null;
  observedAt?: string;
}): Promise<void> {
  const isReady = await areSupabaseTablesReady();
  const client = isReady ? getSupabase() : null;
  const now = observation.observedAt || new Date().toISOString();
  const currency = observation.currency || 'INR';

  if (client) {
    try {
      await client.from('price_stock_history').upsert({
        product_id: observation.productId,
        price: observation.price,
        currency,
        stock: observation.stock,
        is_in_stock: observation.isInStock,
        observed_at: now
      }, { onConflict: 'product_id,observed_at' });
    } catch {
      // Non-fatal
    }
  }

  // Always update in-memory cache as well
  memoryStore.history.push({
    id: memoryStore.historyIdCounter++,
    product_id: observation.productId,
    price: observation.price,
    currency,
    stock: observation.stock,
    is_in_stock: observation.isInStock,
    observed_at: now,
    created_at: now
  });

  const p = memoryStore.products.get(observation.productId);
  if (p) {
    p.latest_price = observation.price;
    p.latest_currency = currency;
    p.latest_stock = observation.stock;
    p.latest_is_in_stock = observation.isInStock;
    p.latest_observed_at = now;
  }
}
