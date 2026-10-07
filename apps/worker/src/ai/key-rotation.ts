/**
 * API key pool with rotation for rate-limited providers (e.g. OpenRouter free tier).
 *
 * ASTRA_AI_API_KEY may contain comma-separated keys. This module stores them all and
 * rotates to the next key on 429/rate-limit failures. Downstream code reads the env var
 * directly, so swapping process.env is sufficient — no plumbing changes needed.
 */

import { GENERIC_API_KEY_ENV } from './models.js';

let keys: string[] = [];
let currentIndex = 0;
let startIndex = 0;

/** Parse comma-separated keys from the env var and activate the first one. */
export function initKeyPool(envValue: string): void {
  keys = envValue.split(',').map((k) => k.trim()).filter(Boolean);
  currentIndex = 0;
  if (keys.length > 0) {
    process.env[GENERIC_API_KEY_ENV] = keys[0];
  }
}

/**
 * Advance to the next key and update the env var. Returns true if a new key
 * was activated, false when all keys have been tried in this rotation cycle.
 * Uses circular rotation so the pool can be retried after a resetKeyPool().
 */
export function rotateKey(): boolean {
  if (keys.length <= 1) return false;
  const nextIndex = (currentIndex + 1) % keys.length;
  // If we've wrapped all the way around, signal exhaustion
  if (nextIndex === startIndex) return false;
  currentIndex = nextIndex;
  process.env[GENERIC_API_KEY_ENV] = keys[currentIndex];
  return true;
}

/** Reset rotation back to the first key — call at the start of each agent attempt. */
export function resetKeyPool(): void {
  currentIndex = 0;
  startIndex = 0;
  if (keys.length > 0) {
    process.env[GENERIC_API_KEY_ENV] = keys[0];
  }
}

export function getKeyCount(): number {
  return keys.length;
}

export function getCurrentKeyIndex(): number {
  return currentIndex;
}

/** Whether an error message indicates the key/provider should be rotated (rate limit or overload). */
export function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('503') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('overloaded') ||
    lower.includes('service temporarily') ||
    lower.includes('too many requests') ||
    // OpenRouter free tier specific errors
    lower.includes('no choices') ||
    lower.includes('upstream') ||
    lower.includes('provider returned') ||
    lower.includes('stream terminated') ||
    lower.includes('stream error') ||
    lower.includes('connection reset') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up') ||
    lower.includes('premature close') ||
    lower.includes('fetch failed') ||
    lower.includes('network error') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('empty response') ||
    lower.includes('context window') ||
    lower.includes('credits') ||
    lower.includes('quota exceeded') ||
    lower.includes('capacity') ||
    lower.includes('try again')
  );
}
