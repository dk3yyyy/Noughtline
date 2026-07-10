const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionRateLimiter } = require('../game/actionRateLimiter');

test('allows actions within a per-key fixed window and returns retry metadata', () => {
  let now = 1_000;
  const limiter = new ActionRateLimiter({ limit: 2, windowMs: 10_000, now: () => now });

  assert.deepEqual(limiter.consume('user:1'), { allowed: true, remaining: 1, resetAt: 11_000 });
  assert.deepEqual(limiter.consume('user:1'), { allowed: true, remaining: 0, resetAt: 11_000 });
  assert.deepEqual(limiter.consume('user:1'), { allowed: false, remaining: 0, resetAt: 11_000, retryAfterMs: 10_000 });

  now = 11_000;
  assert.deepEqual(limiter.consume('user:1'), { allowed: true, remaining: 1, resetAt: 21_000 });
});

test('isolates authenticated users and can clear stale keys', () => {
  let now = 0;
  const limiter = new ActionRateLimiter({ limit: 1, windowMs: 100, now: () => now });

  assert.equal(limiter.consume('user:1').allowed, true);
  assert.equal(limiter.consume('user:2').allowed, true);
  assert.equal(limiter.consume('user:1').allowed, false);

  now = 101;
  assert.equal(limiter.prune(), 2);
  assert.equal(limiter.size, 0);
});
