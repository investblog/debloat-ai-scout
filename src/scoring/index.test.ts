import { describe, expect, it } from "vitest";
import type { ScoredCandidate, CandidateBlock } from "@/shared/types";
import { filterActionable, getVerdict } from "./index";

function makeScored(totalScore: number): ScoredCandidate {
	return {
		block: {} as CandidateBlock,
		signals: [],
		totalScore,
		category: "ai",
		blockFingerprint: "abc123",
		layoutFingerprint: "def456",
	};
}

describe("getVerdict", () => {
	it("returns auto_issue for score >= 6", () => {
		expect(getVerdict(makeScored(6))).toBe("auto_issue");
		expect(getVerdict(makeScored(10))).toBe("auto_issue");
	});

	it("returns review_candidate for score 4-5", () => {
		expect(getVerdict(makeScored(4))).toBe("review_candidate");
		expect(getVerdict(makeScored(5))).toBe("review_candidate");
	});

	it("returns ignore for score < 4", () => {
		expect(getVerdict(makeScored(0))).toBe("ignore");
		expect(getVerdict(makeScored(3))).toBe("ignore");
	});
});

describe("filterActionable", () => {
	it("keeps auto_issue and review_candidate, drops ignore", () => {
		const candidates = [makeScored(8), makeScored(4), makeScored(2), makeScored(6)];
		const result = filterActionable(candidates);
		expect(result).toHaveLength(3);
		expect(result.map((c) => c.totalScore)).toEqual([8, 4, 6]);
	});

	it("returns empty for all-ignore candidates", () => {
		const candidates = [makeScored(0), makeScored(1), makeScored(3)];
		expect(filterActionable(candidates)).toHaveLength(0);
	});
});
