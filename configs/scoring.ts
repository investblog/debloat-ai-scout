/** Score weights for signal types */
export const SCORE_WEIGHTS = {
	keyword: 3,
	placement: 2,
	action_button: 2,
	shadow_dom: 1,
	selector_mismatch: 2,
} as const;

/** Thresholds for issue creation */
export const SCORE_THRESHOLDS = {
	/** Score >= this → auto-create issue */
	autoIssue: 6,
	/** Score >= this → mark as review candidate */
	reviewCandidate: 4,
	/** Score < reviewCandidate → ignore */
} as const;
