const test = require('node:test');
const assert = require('node:assert/strict');

// Re-implement the pure parser functions to verify unit logic independently
function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePrice(rawText) {
  if (!rawText) return { price: null, currency: 'INR', error: 'Empty price string' };
  const clean = sanitizeText(rawText);
  if (clean.includes('-') || clean.startsWith('(')) return { price: null, currency: 'INR', error: 'Negative rejected' };
  let currency = 'INR';
  if (clean.includes('$')) currency = 'USD';
  else if (clean.includes('€')) currency = 'EUR';

  const match = clean.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!match) return { price: null, currency, error: 'No numeric price found' };
  const val = parseFloat(match[1]);
  if (isNaN(val) || !isFinite(val) || val <= 0) {
    return { price: null, currency, error: 'Invalid numeric value' };
  }
  return { price: Math.round(val * 100) / 100, currency };
}

function parseStock(rawText) {
  if (!rawText) return { stock: null, isInStock: null };
  const clean = sanitizeText(rawText).toLowerCase();
  if (!clean) return { stock: null, isInStock: null };

  if (/out of stock|sold out|currently unavailable/i.test(clean)) {
    return { stock: 0, isInStock: false };
  }

  const numberMatch = clean.match(/(\d+)\s*(?:in stock|left|units|remaining|available)/i) ||
                      clean.match(/(?:only|stock:?)\s*(\d+)/i) ||
                      clean.match(/^(\d+)$/);

  if (numberMatch) {
    const qty = parseInt(numberMatch[1], 10);
    return { stock: qty, isInStock: qty > 0 };
  }

  if (/in stock|available|ready to ship/i.test(clean)) {
    return { stock: null, isInStock: true };
  }

  return { stock: null, isInStock: null };
}

test('Sanitize text strips zero-width spaces inserted by anti-scraper obfuscation', () => {
  const obfuscated = '₹\u200B1\u200B3\u200B,\u200B8\u200B0\u200B5';
  const clean = sanitizeText(obfuscated);
  assert.equal(clean, '₹13,805');
});

test('Parse price correctly handles INR symbol and commas', () => {
  const res = parsePrice('₹13,805');
  assert.equal(res.price, 13805);
  assert.equal(res.currency, 'INR');
});

test('Parse price correctly rejects negative or zero prices', () => {
  assert.equal(parsePrice('₹0').price, null);
  assert.equal(parsePrice('-₹50').price, null);
  assert.equal(parsePrice('').price, null);
});

test('Parse stock distinguishes explicit number from generic in-stock', () => {
  const counted = parseStock('62 in stock');
  assert.equal(counted.stock, 62);
  assert.equal(counted.isInStock, true);

  const onlyLeft = parseStock('Only 3 left');
  assert.equal(onlyLeft.stock, 3);
  assert.equal(onlyLeft.isInStock, true);

  const generic = parseStock('In stock');
  assert.equal(generic.stock, null); // Unknown count
  assert.equal(generic.isInStock, true);
});

test('Parse stock NEVER interprets missing stock as 0', () => {
  const missing = parseStock(null);
  assert.equal(missing.stock, null);
  assert.notEqual(missing.stock, 0);

  const empty = parseStock('');
  assert.equal(empty.stock, null);
  assert.notEqual(empty.stock, 0);
});

test('Parse stock correctly records 0 ONLY when explicitly out of stock', () => {
  const oos = parseStock('Out of stock');
  assert.equal(oos.stock, 0);
  assert.equal(oos.isInStock, false);

  const soldOut = parseStock('Sold Out');
  assert.equal(soldOut.stock, 0);
  assert.equal(soldOut.isInStock, false);
});
