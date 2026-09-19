export interface ScrapeResult {
  productId: number;
  success: boolean;
  price: number | null;
  currency: string;
  stock: number | null;
  isInStock: boolean | null;
  httpStatus?: number | null;
  durationMs: number;
  attemptsCount: number;
  errorMessage?: string | null;
  diagnostics?: Record<string, unknown>;
}

export interface ScrapeOptions {
  headless?: boolean;
  slowMo?: number;
  timeoutMs?: number;
  maxRetries?: number;
  onAttempt?: (attemptNum: number, status: 'retried' | 'success' | 'failed', error?: string) => Promise<void>;
}

export interface ParsedPriceStock {
  price: number | null;
  currency: string;
  stock: number | null;
  isInStock: boolean | null;
  rawPriceText: string;
  rawStockText: string;
  isValid: boolean;
  validationError?: string;
}
