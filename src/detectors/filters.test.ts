import { describe, expect, it } from "vitest";
import type { CandidateBlock, ScoredCandidate } from "@/shared/types";
import { applyFilters, filterNestedCandidates, filterOrganicResults, filterStructural } from "./filters";

function makeBlock(overrides: Partial<CandidateBlock> = {}): CandidateBlock {
	return {
		html: "<div>test</div>",
		selector: "div.ai-block",
		textContent: "AI copilot answer",
		tagName: "DIV",
		classes: ["ai-block"],
		role: null,
		ariaLabel: null,
		depth: 5,
		parentTag: "SECTION",
		siblingCount: 3,
		boundingBox: { x: 0, y: 200, width: 400, height: 300 },
		inShadowDom: false,
		...overrides,
	};
}

function makeScored(
	block: CandidateBlock,
	signals: ScoredCandidate["signals"] = [],
): ScoredCandidate {
	return {
		block,
		signals,
		totalScore: signals.reduce((s, sig) => s + sig.score, 0),
		category: "ai",
		blockFingerprint: "abc",
		layoutFingerprint: "def",
	};
}

describe("filterStructural", () => {
	it("removes HEADER elements", () => {
		const result = filterStructural([makeBlock({ tagName: "HEADER", selector: "header#b_header" })]);
		expect(result).toHaveLength(0);
	});

	it("removes FOOTER elements", () => {
		const result = filterStructural([makeBlock({ tagName: "FOOTER", selector: "footer" })]);
		expect(result).toHaveLength(0);
	});

	it("removes NAV elements", () => {
		const result = filterStructural([makeBlock({ tagName: "NAV", selector: "nav" })]);
		expect(result).toHaveLength(0);
	});

	it("removes shallow MAIN elements", () => {
		const result = filterStructural([makeBlock({ tagName: "MAIN", depth: 2, selector: "main" })]);
		expect(result).toHaveLength(0);
	});

	it("keeps deep MAIN elements", () => {
		const result = filterStructural([
			makeBlock({ tagName: "MAIN", depth: 5, selector: "div > section > main" }),
		]);
		expect(result).toHaveLength(1);
	});

	it("removes oversized elements", () => {
		const result = filterStructural([
			makeBlock({ boundingBox: { x: 0, y: 0, width: 1440, height: 900 } }),
		]);
		expect(result).toHaveLength(0);
	});

	it("keeps normal-sized AI blocks", () => {
		const result = filterStructural([
			makeBlock({ boundingBox: { x: 0, y: 200, width: 600, height: 200 } }),
		]);
		expect(result).toHaveLength(1);
	});

	it("removes #recaptcha", () => {
		const result = filterStructural([makeBlock({ selector: "#recaptcha" })]);
		expect(result).toHaveLength(0);
	});

	it("removes #id_h (Bing account area)", () => {
		const result = filterStructural([makeBlock({ selector: "#id_h" })]);
		expect(result).toHaveLength(0);
	});

	it("removes #id_h when nested in selector path", () => {
		const result = filterStructural([makeBlock({ selector: "div#id_h" })]);
		expect(result).toHaveLength(0);
	});

	it("removes elements containing #rh_rwm in path", () => {
		const result = filterStructural([makeBlock({ selector: "div#rh_rwm" })]);
		expect(result).toHaveLength(0);
	});
});

describe("filterOrganicResults", () => {
	it("removes organic Bing results with keyword-only signals", () => {
		const block = makeBlock({ selector: "ol#b_results > li.b_algo > div.b_caption" });
		const scored = makeScored(block, [{ type: "keyword", value: "ai:ai", score: 3 }]);
		const result = filterOrganicResults([scored]);
		expect(result).toHaveLength(0);
	});

	it("keeps organic results with structural signals", () => {
		const block = makeBlock({ selector: "ol#b_results > li.b_algo > div.b_caption" });
		const scored = makeScored(block, [
			{ type: "keyword", value: "ai:ai", score: 3 },
			{ type: "action_button", value: "summarize", score: 2 },
		]);
		const result = filterOrganicResults([scored]);
		expect(result).toHaveLength(1);
	});

	it("keeps non-organic elements regardless of signals", () => {
		const block = makeBlock({ selector: "div#b_copilot_search_container" });
		const scored = makeScored(block, [{ type: "keyword", value: "ai:ai", score: 3 }]);
		const result = filterOrganicResults([scored]);
		expect(result).toHaveLength(1);
	});
});

describe("applyFilters", () => {
	it("filters out both structural and organic false positives", () => {
		const header = makeBlock({ tagName: "HEADER", selector: "header#b_header" });
		const organic = makeBlock({ selector: "ol#b_results > li.b_algo > div.b_caption" });
		const copilot = makeBlock({ selector: "div#b_copilot_search_container" });

		const candidates = [header, organic, copilot];
		const scored = [
			makeScored(header, [
				{ type: "keyword", value: "ai:ai", score: 3 },
				{ type: "placement", value: "top:y=0", score: 2 },
			]),
			makeScored(organic, [{ type: "keyword", value: "ai:ai", score: 3 }]),
			makeScored(copilot, [{ type: "keyword", value: "ai:ai", score: 3 }]),
		];

		const result = applyFilters(candidates, scored);
		expect(result).toHaveLength(1);
		expect(result[0]!.block.selector).toContain("copilot");
	});
});

describe("filterNestedCandidates", () => {
	it("removes child when parent is present", () => {
		const parent = makeBlock({ selector: "div#copilot" });
		const child = makeBlock({ selector: "div#copilot > div.inner" });
		const result = filterNestedCandidates([
			makeScored(parent),
			makeScored(child),
		]);
		expect(result).toHaveLength(1);
		expect(result[0]!.block.selector).toBe("div#copilot");
	});

	it("keeps siblings", () => {
		const a = makeBlock({ selector: "div#copilot" });
		const b = makeBlock({ selector: "div#composer" });
		const result = filterNestedCandidates([
			makeScored(a),
			makeScored(b),
		]);
		expect(result).toHaveLength(2);
	});

	it("keeps all when none are nested", () => {
		const result = filterNestedCandidates([
			makeScored(makeBlock({ selector: "div.a" })),
			makeScored(makeBlock({ selector: "section.b" })),
		]);
		expect(result).toHaveLength(2);
	});
});
