/**
 * Internal class vocabulary for reconciliation and exploitation.
 *
 * Public configuration continues to use the five-class `VulnClass`. The
 * analysis-less `miscellaneous` class exists only after an effective SAST
 * reference enters the internal pipeline.
 */

import type { VulnClass } from './config.js';

export type ReconciliationClass = VulnClass;

/** Fixed processing and report-input order for all internal classes. */
export const ALL_RECONCILIATION_CLASSES = ['injection'] as const satisfies readonly ReconciliationClass[];
