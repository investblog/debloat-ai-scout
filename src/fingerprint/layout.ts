import { createHash } from "node:crypto";
import type { CandidateBlock } from "@/shared/types";

/**
 * Compute a layout fingerprint for a candidate element.
 * Identifies a page zone / insertion area rather than
 * a specific element. Used for coarse drift detection —
 * "new type of insertion in the same zone".
 */
export function computeLayoutFingerprint(block: CandidateBlock): string {
	const zone = classifyZone(block);

	const parts = [
		zone,
		block.parentTag?.toLowerCase() ?? "",
		String(block.depth),
		block.inShadowDom ? "shadow" : "light",
	];

	return hashString(parts.join("|"));
}

/**
 * Classify the page zone based on bounding box position.
 * Divides viewport into coarse zones for stable comparison.
 */
function classifyZone(block: CandidateBlock): string {
	if (!block.boundingBox) return "unknown";

	const { y, height } = block.boundingBox;
	const centerY = y + height / 2;

	// Coarse vertical zones (relative to typical 900px viewport)
	if (centerY < 200) return "top";
	if (centerY < 500) return "middle";
	return "bottom";
}

function hashString(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
