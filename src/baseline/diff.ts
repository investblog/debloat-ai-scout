import type { BaselineEntry, ScoredCandidate } from "@/shared/types";

export interface DiffResult {
	/** Candidates present now but absent in baseline */
	added: ScoredCandidate[];
	/** Fingerprints in baseline but not in current scan */
	removed: string[];
	/** Same layout zone, different block fingerprint (UI changed in-place) */
	changed: Array<{
		current: ScoredCandidate;
		previousFingerprint: string;
	}>;
	/** Candidates that match baseline exactly (no change) */
	unchanged: ScoredCandidate[];
	/** Whether this is the first scan (no baseline exists) */
	isFirstScan: boolean;
}

/**
 * Compare current scored candidates against a stored baseline.
 * Returns categorized diff: added, removed, changed, unchanged.
 */
export function diffAgainstBaseline(
	current: ScoredCandidate[],
	baseline: BaselineEntry | null,
): DiffResult {
	// First scan — everything is "added"
	if (!baseline) {
		return {
			added: current,
			removed: [],
			changed: [],
			unchanged: [],
			isFirstScan: true,
		};
	}

	const baselineBlocks = new Set(baseline.fingerprints.block);
	const baselineLayouts = new Set(baseline.fingerprints.layout);

	// Build layout → block fingerprint map from baseline
	// We need paired data, so reconstruct from arrays (same index = same candidate)
	const layoutToBlock = new Map<string, string>();
	for (let i = 0; i < baseline.fingerprints.layout.length; i++) {
		const layout = baseline.fingerprints.layout[i]!;
		const block = baseline.fingerprints.block[i]!;
		layoutToBlock.set(layout, block);
	}

	const added: ScoredCandidate[] = [];
	const changed: DiffResult["changed"] = [];
	const unchanged: ScoredCandidate[] = [];
	const matchedBaselineBlocks = new Set<string>();

	for (const candidate of current) {
		if (baselineBlocks.has(candidate.blockFingerprint)) {
			// Exact match — unchanged
			unchanged.push(candidate);
			matchedBaselineBlocks.add(candidate.blockFingerprint);
		} else if (baselineLayouts.has(candidate.layoutFingerprint)) {
			// Same zone, different block — changed
			const previousFingerprint = layoutToBlock.get(candidate.layoutFingerprint) ?? "unknown";
			changed.push({ current: candidate, previousFingerprint });
			matchedBaselineBlocks.add(previousFingerprint);
		} else {
			// Not in baseline at all — added
			added.push(candidate);
		}
	}

	// Removed: baseline blocks that weren't matched by any current candidate
	const removed = baseline.fingerprints.block.filter(
		(fp) => !matchedBaselineBlocks.has(fp),
	);

	return {
		added,
		removed,
		changed,
		unchanged,
		isFirstScan: false,
	};
}

/**
 * Build a BaselineEntry from current scan results.
 */
export function buildBaseline(
	profileKey: string,
	candidates: ScoredCandidate[],
	snapshot: { url: string; title: string; timestamp: string; reducedHtml: string },
	runId: string,
): BaselineEntry {
	return {
		profileKey,
		snapshot: {
			...snapshot,
			candidates: candidates.map((c) => c.block),
		},
		fingerprints: {
			block: candidates.map((c) => c.blockFingerprint),
			layout: candidates.map((c) => c.layoutFingerprint),
		},
		metadata: {
			timestamp: new Date().toISOString(),
			runId,
		},
	};
}
