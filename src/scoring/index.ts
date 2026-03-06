import { SCORE_THRESHOLDS } from "@configs/scoring";
import type { ScoredCandidate } from "@/shared/types";

export type ScoreVerdict = "auto_issue" | "review_candidate" | "ignore";

/** Classify a scored candidate by threshold */
export function getVerdict(candidate: ScoredCandidate): ScoreVerdict {
	if (candidate.totalScore >= SCORE_THRESHOLDS.autoIssue) return "auto_issue";
	if (candidate.totalScore >= SCORE_THRESHOLDS.reviewCandidate) return "review_candidate";
	return "ignore";
}

/** Filter candidates that should create issues */
export function filterActionable(candidates: ScoredCandidate[]): ScoredCandidate[] {
	return candidates.filter((c) => getVerdict(c) !== "ignore");
}
