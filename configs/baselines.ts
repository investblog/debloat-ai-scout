/** Labels that allow baseline refresh */
export const BASELINE_REFRESH_LABELS = [
	"fixed",
	"accepted-baseline-update",
	"expected-ui-change",
] as const;

/** Labels that deny baseline refresh */
export const BASELINE_DENY_LABELS = [
	"false-positive",
	"duplicate",
	"invalid",
	"not-relevant",
] as const;

/** Maximum age of a candidate baseline before it expires (7 days) */
export const CANDIDATE_BASELINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
