import type { CandidateBlock, ScoredCandidate } from "@/shared/types";

/**
 * Structural tags that are page-level containers, not AI insertions.
 * These should never be flagged as candidates.
 */
/**
 * ID-based structural selectors. Matched via `includes` so they catch
 * both `#id_h` and `div#id_h` forms.
 */
const STRUCTURAL_IDS = [
	"#b_header",
	"#b_footer",
	"#b_content",
	"#b_context",
	"#id_h",
	"#rh_rwm",
	"#recaptcha",
] as const;

/**
 * Maximum element area (width * height) to consider.
 * Elements larger than this are page-level containers, not specific AI blocks.
 */
const MAX_AREA = 800 * 600;

/**
 * Minimum text length to trigger keyword scoring.
 * Prevents false positives from organic search results that
 * mention AI keywords because the search query is about AI.
 */
const MIN_AI_SPECIFIC_SIGNAL_LENGTH = 0;

/**
 * Filter out candidates that are clearly structural/page-level elements.
 */
export function filterStructural(candidates: CandidateBlock[]): CandidateBlock[] {
	return candidates.filter((block) => {
		// Filter by tag — top-level structural elements
		const tag = block.tagName.toLowerCase();
		if (tag === "header" || tag === "footer" || tag === "nav") return false;
		if (tag === "main" && block.depth <= 3) return false;

		// Filter by known structural IDs (match anywhere in selector path)
		const sel = block.selector.toLowerCase();
		for (const id of STRUCTURAL_IDS) {
			if (sel.includes(id)) return false;
		}

		// Filter by area — too large = container, not a specific element
		if (block.boundingBox) {
			const area = block.boundingBox.width * block.boundingBox.height;
			if (area > MAX_AREA) return false;
		}

		return true;
	});
}

/**
 * Filter out organic search results that match keywords only because
 * the search query is about AI.
 *
 * Heuristic: if a candidate is inside a search result list item
 * (e.g. .b_algo, .g, .result) and its only signal is keyword match
 * on the content text, it's probably an organic result, not an AI insertion.
 */
export function filterOrganicResults(scored: ScoredCandidate[]): ScoredCandidate[] {
	return scored.filter((c) => {
		const sel = c.block.selector.toLowerCase();
		const isOrganic =
			sel.includes("b_algo") ||
			sel.includes(".g ") ||
			sel.includes(".result") ||
			sel.includes("b_results > li");

		if (!isOrganic) return true;

		// Keep if it has non-keyword signals (placement, action_button, shadow_dom)
		const hasStructuralSignal = c.signals.some(
			(s) => s.type !== "keyword",
		);

		return hasStructuralSignal;
	});
}

/**
 * Full filter pipeline: structural → organic → return cleaned list.
 */
export function applyFilters(
	candidates: CandidateBlock[],
	scored: ScoredCandidate[],
): ScoredCandidate[] {
	// Step 1: get IDs of structurally filtered candidates
	const structurallyValid = new Set(
		filterStructural(candidates).map((c) => c.selector),
	);

	// Step 2: remove structurally invalid from scored
	const afterStructural = scored.filter((s) => structurallyValid.has(s.block.selector));

	// Step 3: filter organic results
	return filterOrganicResults(afterStructural);
}
