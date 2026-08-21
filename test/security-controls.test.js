import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowLimiter } from "../security-controls.js";

test("fixed-window limiter rejects requests above the configured limit", () => {
  const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1_000 });
  assert.equal(limiter.consume("client", 0).allowed, true);
  assert.equal(limiter.consume("client", 1).allowed, true);
  const blocked = limiter.consume("client", 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.consume("client", 1_001).allowed, true);
});

test("fixed-window limiter bounds the number of tracked clients", () => {
  const limiter = new FixedWindowLimiter({ limit: 2, windowMs: 1_000, maxKeys: 2 });
  assert.equal(limiter.consume("one", 0).allowed, true);
  assert.equal(limiter.consume("two", 0).allowed, true);
  assert.equal(limiter.consume("three", 0).allowed, false);
  assert.equal(limiter.consume("three", 1_001).allowed, true);
});
