import { createHash } from "node:crypto";
import type { CandidateBlock } from "@/shared/types";

/**
 * Compute a stable block fingerprint from a candidate element.
 * Used for duplicate suppression — same block across runs
 * produces the same fingerprint.
 */
export function computeBlockFingerprint(block: CandidateBlock): string {
	const parts = [
		block.tagName.toLowerCase(),
		normalizeClasses(block.classes),
		block.role ?? "",
		block.ariaLabel ?? "",
		trimText(block.textContent, 100),
		String(block.depth),
		block.parentTag?.toLowerCase() ?? "",
		String(block.siblingCount),
	];

	return hashString(parts.join("|"));
}

/**
 * Sort and deduplicate class list for stable fingerprinting.
 * Filters out dynamic/generated classes (hashes, random IDs).
 */
function normalizeClasses(classes: string[]): string {
	return [...new Set(classes)]
		.filter((c) => !isDynamicClass(c))
		.sort()
		.join(",");
}

/**
 * Heuristic to detect dynamically generated class names
 * (e.g. CSS modules hashes, random IDs).
 */
function isDynamicClass(className: string): boolean {
	// Classes with 6+ hex chars likely generated (e.g. "css-a1b2c3")
	if (/[a-f0-9]{6,}/i.test(className) && className.length > 8) return true;
	// Classes that are entirely numeric
	if (/^\d+$/.test(className)) return true;
	return false;
}

/** Trim and normalize whitespace in text content */
function trimText(text: string, maxLen: number): string {
	return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** SHA-256 hash, truncated to 16 hex chars for readability */
function hashString(input: string): string {
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
