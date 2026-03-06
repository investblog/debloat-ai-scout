import { describe, expect, it } from "vitest";
import type { BaselineEntry, CandidateBlock, ScoredCandidate } from "@/shared/types";
import { buildBaseline, diffAgainstBaseline } from "./diff";

function makeScored(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
	return {
		block: {
			html: "<div>test</div>",
			selector: "div.test",
			textContent: "AI block",
			tagName: "DIV",
			classes: ["ai-block"],
			role: null,
			ariaLabel: null,
			depth: 3,
			parentTag: "SECTION",
			siblingCount: 2,
			boundingBox: { x: 0, y: 200, width: 400, height: 200 },
			inShadowDom: false,
		},
		signals: [],
		totalScore: 6,
		category: "ai",
		blockFingerprint: "block_aaa",
		layoutFingerprint: "layout_111",
		...overrides,
	};
}

function makeBaseline(blocks: string[], layouts: string[]): BaselineEntry {
	return {
		profileKey: "test:chrome:en-US",
		snapshot: {
			url: "https://example.com",
			title: "Test",
			timestamp: "2026-03-05T00:00:00Z",
			reducedHtml: "<html></html>",
			candidates: [],
		},
		fingerprints: { block: blocks, layout: layouts },
		metadata: { timestamp: "2026-03-05T00:00:00Z", runId: "run-old" },
	};
}

describe("diffAgainstBaseline", () => {
	it("treats all candidates as added on first scan", () => {
		const current = [makeScored(), makeScored({ blockFingerprint: "block_bbb" })];
		const result = diffAgainstBaseline(current, null);

		expect(result.isFirstScan).toBe(true);
		expect(result.added).toHaveLength(2);
		expect(result.removed).toHaveLength(0);
		expect(result.changed).toHaveLength(0);
		expect(result.unchanged).toHaveLength(0);
	});

	it("detects unchanged candidates", () => {
		const current = [makeScored({ blockFingerprint: "block_aaa", layoutFingerprint: "layout_111" })];
		const baseline = makeBaseline(["block_aaa"], ["layout_111"]);
		const result = diffAgainstBaseline(current, baseline);

		expect(result.unchanged).toHaveLength(1);
		expect(result.added).toHaveLength(0);
		expect(result.changed).toHaveLength(0);
	});

	it("detects added candidates", () => {
		const current = [makeScored({ blockFingerprint: "block_new", layoutFingerprint: "layout_new" })];
		const baseline = makeBaseline(["block_aaa"], ["layout_111"]);
		const result = diffAgainstBaseline(current, baseline);

		expect(result.added).toHaveLength(1);
		expect(result.added[0]!.blockFingerprint).toBe("block_new");
	});

	it("detects removed candidates", () => {
		const current: ScoredCandidate[] = [];
		const baseline = makeBaseline(["block_aaa", "block_bbb"], ["layout_111", "layout_222"]);
		const result = diffAgainstBaseline(current, baseline);

		expect(result.removed).toHaveLength(2);
		expect(result.removed).toContain("block_aaa");
		expect(result.removed).toContain("block_bbb");
	});

	it("detects changed candidates (same zone, different block)", () => {
		const current = [
			makeScored({ blockFingerprint: "block_new", layoutFingerprint: "layout_111" }),
		];
		const baseline = makeBaseline(["block_aaa"], ["layout_111"]);
		const result = diffAgainstBaseline(current, baseline);

		expect(result.changed).toHaveLength(1);
		expect(result.changed[0]!.current.blockFingerprint).toBe("block_new");
		expect(result.changed[0]!.previousFingerprint).toBe("block_aaa");
	});

	it("handles mixed scenario", () => {
		const current = [
			makeScored({ blockFingerprint: "block_aaa", layoutFingerprint: "layout_111" }), // unchanged
			makeScored({ blockFingerprint: "block_new", layoutFingerprint: "layout_222" }), // changed (same zone)
			makeScored({ blockFingerprint: "block_xxx", layoutFingerprint: "layout_xxx" }), // added
		];
		const baseline = makeBaseline(
			["block_aaa", "block_bbb", "block_ccc"],
			["layout_111", "layout_222", "layout_333"],
		);
		const result = diffAgainstBaseline(current, baseline);

		expect(result.unchanged).toHaveLength(1);
		expect(result.changed).toHaveLength(1);
		expect(result.added).toHaveLength(1);
		expect(result.removed).toHaveLength(1); // block_ccc
		expect(result.removed).toContain("block_ccc");
	});
});

describe("buildBaseline", () => {
	it("creates a baseline entry from scored candidates", () => {
		const candidates = [
			makeScored({ blockFingerprint: "fp1", layoutFingerprint: "lp1" }),
			makeScored({ blockFingerprint: "fp2", layoutFingerprint: "lp2" }),
		];
		const snapshot = {
			url: "https://example.com",
			title: "Test",
			timestamp: "2026-03-06T00:00:00Z",
			reducedHtml: "<html></html>",
		};

		const baseline = buildBaseline("test:chrome:en-US", candidates, snapshot, "run-123");

		expect(baseline.profileKey).toBe("test:chrome:en-US");
		expect(baseline.fingerprints.block).toEqual(["fp1", "fp2"]);
		expect(baseline.fingerprints.layout).toEqual(["lp1", "lp2"]);
		expect(baseline.metadata.runId).toBe("run-123");
	});
});
