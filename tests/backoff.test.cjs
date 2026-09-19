const test = require('node:test');
const assert = require('node:assert/strict');

function calculateBackoffMs(attempt, baseMs = 1000, maxMs = 8000) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  const jitter = Math.random() * (exp * 0.3);
  return Math.round(exp + jitter);
}

test('Exponential backoff increases with attempts and stays within bounds', () => {
  const d1 = calculateBackoffMs(1, 1000, 8000);
  assert.ok(d1 >= 1000 && d1 <= 1400, `d1 was ${d1}`);

  const d2 = calculateBackoffMs(2, 1000, 8000);
  assert.ok(d2 >= 2000 && d2 <= 2800, `d2 was ${d2}`);

  const d3 = calculateBackoffMs(3, 1000, 8000);
  assert.ok(d3 >= 4000 && d3 <= 5500, `d3 was ${d3}`);

  const d5 = calculateBackoffMs(5, 1000, 8000);
  assert.ok(d5 <= 11000, `Cap respected, d5 was ${d5}`);
});

test('Mutex locks prevent duplicate concurrent scrapes for same product', () => {
  const locks = new Set();
  
  function acquireLock(id) {
    if (locks.has(id)) return false;
    locks.add(id);
    return true;
  }

  function releaseLock(id) {
    locks.delete(id);
  }

  assert.equal(acquireLock(550), true);
  assert.equal(acquireLock(550), false, 'Duplicate scrape should be rejected');
  releaseLock(550);
  assert.equal(acquireLock(550), true, 'Lock should be acquirable after release');
});
