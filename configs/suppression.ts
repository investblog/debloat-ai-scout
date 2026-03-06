/**
 * Static suppression rules.
 * These fingerprints are always ignored regardless of feedback registry.
 * Use for known false positives that should never trigger issues.
 */
export const STATIC_SUPPRESSIONS: string[] = [
	// Add known false-positive block fingerprints here
];

/** Default TTL for feedback-based suppression (30 days) */
export const SUPPRESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
