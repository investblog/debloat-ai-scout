import { SCORE_WEIGHTS } from "@configs/scoring";
import { KEYWORDS_BY_CATEGORY } from "@configs/keywords";
import type {
	CandidateBlock,
	DetectionCategory,
	SignalAnnotation,
	ScoredCandidate,
} from "@/shared/types";
import { computeBlockFingerprint, computeLayoutFingerprint } from "@/fingerprint";

/** Action button keywords that indicate interactive AI elements */
const ACTION_KEYWORDS = [
	"summarize",
	"rewrite",
	"compose",
	"ask",
	"generate",
	"try",
	"chat",
	"explain",
] as const;

/**
 * Run heuristic detection on a list of candidate blocks.
 * Annotates each block with signals and computes a total score.
 */
export function detectAndScore(candidates: CandidateBlock[]): ScoredCandidate[] {
	return candidates.map((block) => {
		const signals = collectSignals(block);
		const totalScore = signals.reduce((sum, s) => sum + s.score, 0);
		const category = classifyCategory(signals);

		return {
			block,
			signals,
			totalScore,
			category,
			blockFingerprint: computeBlockFingerprint(block),
			layoutFingerprint: computeLayoutFingerprint(block),
		};
	});
}

function collectSignals(block: CandidateBlock): SignalAnnotation[] {
	const signals: SignalAnnotation[] = [];
	const text = block.textContent.toLowerCase();
	const label = (block.ariaLabel ?? "").toLowerCase();
	const classes = block.classes.join(" ").toLowerCase();
	const combined = `${text} ${label} ${classes}`;

	// Keyword signals
	for (const [category, keywords] of Object.entries(KEYWORDS_BY_CATEGORY)) {
		for (const kw of keywords) {
			if (combined.includes(kw.toLowerCase())) {
				signals.push({
					type: "keyword",
					value: `${category}:${kw}`,
					score: SCORE_WEIGHTS.keyword,
				});
				break; // One keyword per category is enough
			}
		}
	}

	// Top placement signal
	if (block.boundingBox && block.boundingBox.y < 300) {
		signals.push({
			type: "placement",
			value: `top:y=${Math.round(block.boundingBox.y)}`,
			score: SCORE_WEIGHTS.placement,
		});
	}

	// Action button signal
	const hasActionButton = ACTION_KEYWORDS.some((kw) => combined.includes(kw));
	if (hasActionButton) {
		signals.push({
			type: "action_button",
			value: ACTION_KEYWORDS.find((kw) => combined.includes(kw)) ?? "unknown",
			score: SCORE_WEIGHTS.action_button,
		});
	}

	// Shadow DOM signal
	if (block.inShadowDom) {
		signals.push({
			type: "shadow_dom",
			value: "true",
			score: SCORE_WEIGHTS.shadow_dom,
		});
	}

	return signals;
}

/**
 * Classify the primary detection category based on signals.
 * Picks the category with the most keyword matches.
 */
function classifyCategory(signals: SignalAnnotation[]): DetectionCategory {
	const categoryCounts: Record<string, number> = {};

	for (const signal of signals) {
		if (signal.type === "keyword") {
			const category = signal.value.split(":")[0]!;
			categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
		}
	}

	const entries = Object.entries(categoryCounts);
	if (entries.length === 0) return "unknown_candidate";

	entries.sort((a, b) => b[1] - a[1]);
	return entries[0]![0] as DetectionCategory;
}
