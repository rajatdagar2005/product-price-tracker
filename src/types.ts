export interface TrackedProduct {
  product_id: number;
  name: string;
  slug?: string;
  brand?: string;
  category?: string;
  sku?: string;
  canonical_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  latest_price?: number | null;
  latest_currency?: string | null;
  latest_stock?: number | null;
  latest_is_in_stock?: boolean | null;
  latest_observed_at?: string | null;
  latest_attempt_status?: 'success' | 'retried' | 'failed' | null;
  latest_attempt_duration_ms?: number | null;
  latest_attempt_error?: string | null;
  latest_attempt_at?: string | null;
}

export interface PriceStockObservation {
  id: number;
  product_id: number;
  price: number;
  currency: string;
  stock: number | null;
  is_in_stock: boolean | null;
  observed_at: string;
  created_at: string;
}

export interface ScrapeAttempt {
  id: number;
  product_id: number;
  attempt_number: number;
  status: 'success' | 'retried' | 'failed';
  http_status?: number | null;
  duration_ms: number;
  extracted_price?: number | null;
  extracted_stock?: number | null;
  error_message?: string | null;
  diagnostics?: Record<string, unknown>;
  created_at: string;
}

export interface StoreCatalogItem {
  id: number;
  name: string;
  slug?: string;
  brand?: string;
  category?: string;
  sku?: string;
  inStock?: boolean;
  canonicalUrl: string;
}

export interface SystemHealth {
  status: string;
  dbType: 'supabase' | 'in-memory-fallback';
  dbConnected: boolean;
  uptimeSeconds: number;
  activeTrackedCount: number;
  cronSecretConfigured: boolean;
  targetStoreUrl: string;
}
