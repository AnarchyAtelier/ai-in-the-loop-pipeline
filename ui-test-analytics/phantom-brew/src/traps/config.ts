// Trap configuration - controls intentional instability
// Each trap can be toggled for testing purposes

export const TRAPS = {
  // === FALSE POSITIVE TRAPS ===

  // FP-1: Optimistic UI + rollback on cart add (5% chance)
  FP1_ROLLBACK_RATE: 0.05,

  // FP-2: SSE status update random delay (3s - 30s per stage)
  FP2_STATUS_MIN_DELAY_MS: 3000,
  FP2_STATUS_MAX_DELAY_MS: 30000,

  // FP-3: A/B test layout variant (50% chance of variant B)
  FP3_AB_TEST_RATE: 0.5,

  // FP-4: Rate limit (max requests per window)
  FP4_RATE_LIMIT_WINDOW_MS: 10000,
  FP4_RATE_LIMIT_MAX_REQUESTS: 20,

  // FP-5: Staggered fade-in animation duration (ms)
  FP5_ANIMATION_DURATION_MS: 300,
  FP5_STAGGER_DELAY_MS: 80,

  // FP-6: Cold start slow responses (first N requests)
  FP6_COLD_START_COUNT: 5,
  FP6_COLD_START_DELAY_MS: 3000,

  // === FALSE NEGATIVE TRAPS ===

  // FN-1: Tax rounding per-item instead of on total
  FN1_TAX_RATE: 0.10,

  // FN-2: Sort doesn't update href (always enabled)
  // Implemented in client-side JS

  // FN-3: Coupon shows message but doesn't update total
  // Implemented in cart route

  // FN-4: Pagination boundary bug at exactly 10 items
  FN4_ITEMS_PER_PAGE: 10,

  // FN-5: Quantity rapid-click race condition window (ms)
  FN5_RACE_WINDOW_MS: 100,

  // FN-6: No server-side email validation
  // Implemented by omission in checkout route
};

export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function shouldTrigger(rate: number): boolean {
  return Math.random() < rate;
}
