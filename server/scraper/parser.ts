import { ParsedPriceStock } from './types';

/**
 * Strips zero-width characters, non-breaking spaces, and hidden unicode noise.
 * The mock storefront injects zero-width spaces (\u200B) between numbers to confuse crude scrapers.
 */
export function sanitizeText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Zero-width spaces & joiners
    .replace(/\u00A0/g, ' ')               // Non-breaking space
    .replace(/\s+/g, ' ')                  // Normalize whitespace
    .trim();
}

/**
 * Parses and validates raw price text extracted from the visible DOM or API payload.
 * Rejects non-numeric, zero, negative, or malformed prices.
 */
export function parsePrice(rawText: string | null | undefined): { price: number | null; currency: string; error?: string } {
  if (!rawText) {
    return { price: null, currency: 'INR', error: 'Empty price string' };
  }

  const clean = sanitizeText(rawText);
  let currency = 'INR';

  if (clean.includes('-') || clean.startsWith('(')) {
    return { price: null, currency, error: `Negative price rejected: "${clean}"` };
  }

  if (clean.includes('₹') || /rs\.?/i.test(clean) || /inr/i.test(clean)) {
    currency = 'INR';
  } else if (clean.includes('$') || /usd/i.test(clean)) {
    currency = 'USD';
  } else if (clean.includes('€') || /eur/i.test(clean)) {
    currency = 'EUR';
  }

  // Remove currency signs, words, commas
  // Match standard numeric format with optional decimal: e.g. 13,805 or 13805.50
  const numericMatch = clean.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!numericMatch) {
    return { price: null, currency, error: `Could not parse numeric price from: "${clean}"` };
  }

  const priceVal = parseFloat(numericMatch[1]);
  if (isNaN(priceVal) || !isFinite(priceVal) || priceVal <= 0) {
    return { price: null, currency, error: `Invalid parsed price value: ${priceVal}` };
  }

  // Round to 2 decimal places
  const price = Math.round(priceVal * 100) / 100;
  return { price, currency };
}

/**
 * Parses raw stock text into a structured stock count and availability flag.
 *
 * CRITICAL RULE:
 * - "Out of stock" -> stock = 0, isInStock = false
 * - "62 in stock" / "Only 4 left" -> stock = 62 / 4, isInStock = true
 * - "In stock" (no count provided) -> stock = null, isInStock = true
 * - Missing / unstated stock -> stock = null, isInStock = null
 * NEVER interpret missing stock as 0.
 */
export function parseStock(rawText: string | null | undefined): { stock: number | null; isInStock: boolean | null } {
  if (!rawText) {
    return { stock: null, isInStock: null };
  }

  const clean = sanitizeText(rawText).toLowerCase();
  if (!clean) {
    return { stock: null, isInStock: null };
  }

  // Explicit out of stock indicators
  if (/out of stock|sold out|currently unavailable|not in stock/i.test(clean)) {
    return { stock: 0, isInStock: false };
  }

  // Numerical stock expressions:
  // "62 in stock", "only 5 left", "hurry, 3 units remaining", "stock: 15"
  const numberMatch = clean.match(/(\d+)\s*(?:in stock|left|units|remaining|available)/i) ||
                      clean.match(/(?:only|stock:?)\s*(\d+)/i) ||
                      clean.match(/^(\d+)$/);

  if (numberMatch) {
    const qty = parseInt(numberMatch[1], 10);
    return {
      stock: qty,
      isInStock: qty > 0
    };
  }

  // Generic in-stock indicator without explicit number
  if (/in stock|available|ready to ship/i.test(clean)) {
    return {
      stock: null, // Unknown exact count
      isInStock: true
    };
  }

  // Fallback: could not determine stock
  return { stock: null, isInStock: null };
}

/**
 * Combines price and stock parsing with strict validation before recording a successful observation.
 */
export function validateObservation(
  rawPrice: string | null | undefined,
  rawStock: string | null | undefined
): ParsedPriceStock {
  const { price, currency, error: priceError } = parsePrice(rawPrice);
  const { stock, isInStock } = parseStock(rawStock);

  if (!price || priceError) {
    return {
      price: null,
      currency,
      stock,
      isInStock,
      rawPriceText: rawPrice || '',
      rawStockText: rawStock || '',
      isValid: false,
      validationError: priceError || 'Price validation failed'
    };
  }

  return {
    price,
    currency,
    stock,
    isInStock,
    rawPriceText: rawPrice || '',
    rawStockText: rawStock || '',
    isValid: true
  };
}
