/**
 * Signal keywords for heuristic detection.
 * Grouped by detection category.
 * Maintained separately from detector logic for easy updates.
 */

export const AI_KEYWORDS = [
	"ai",
	"copilot",
	"gemini",
	"assistant",
	"summarize",
	"rewrite",
	"compose",
	"answer",
	"chat",
	"generative",
	"ai-generated",
	"ai-overview",
	"ask ai",
	"ai answer",
	"powered by ai",
	"duet ai",
	"bard",
	"bing chat",
	"microsoft copilot",
	"google ai",
] as const;

export const SPONSORED_KEYWORDS = [
	"sponsored",
	"ad",
	"advertisement",
	"promoted",
	"paid",
] as const;

export const SHOPPING_KEYWORDS = [
	"shop",
	"buy",
	"price",
	"deal",
	"cart",
	"add to cart",
	"shopping",
] as const;

export const ANNOYANCE_KEYWORDS = [
	"newsletter",
	"subscribe",
	"notification",
	"cookie",
	"consent",
] as const;

/** All keywords by category */
export const KEYWORDS_BY_CATEGORY = {
	ai: AI_KEYWORDS,
	sponsored: SPONSORED_KEYWORDS,
	shopping: SHOPPING_KEYWORDS,
	annoyances: ANNOYANCE_KEYWORDS,
} as const;
