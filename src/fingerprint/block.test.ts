import { describe, expect, it } from "vitest";
import type { CandidateBlock } from "@/shared/types";
import { computeBlockFingerprint } from "./block";

function makeBlock(overrides: Partial<CandidateBlock> = {}): CandidateBlock {
	return {
		html: "<div>test</div>",
		selector: "div.test",
		textContent: "Hello AI assistant",
		tagName: "DIV",
		classes: ["ai-answer", "block"],
		role: "region",
		ariaLabel: "AI Answer",
		depth: 3,
		parentTag: "MAIN",
		siblingCount: 2,
		boundingBox: { x: 0, y: 100, width: 800, height: 200 },
		inShadowDom: false,
		...overrides,
	};
}

describe("computeBlockFingerprint", () => {
	it("produces a hex string", () => {
		const fp = computeBlockFingerprint(makeBlock());
		expect(fp).toMatch(/^[a-f0-9]{16}$/);
	});

	it("is deterministic", () => {
		const block = makeBlock();
		const fp1 = computeBlockFingerprint(block);
		const fp2 = computeBlockFingerprint(block);
		expect(fp1).toBe(fp2);
	});

	it("is stable with reordered classes", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ classes: ["ai-answer", "block"] }));
		const fp2 = computeBlockFingerprint(makeBlock({ classes: ["block", "ai-answer"] }));
		expect(fp1).toBe(fp2);
	});

	it("is stable with duplicate classes", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ classes: ["ai-answer", "block"] }));
		const fp2 = computeBlockFingerprint(
			makeBlock({ classes: ["ai-answer", "block", "ai-answer"] }),
		);
		expect(fp1).toBe(fp2);
	});

	it("filters out dynamic/generated classes", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ classes: ["ai-answer"] }));
		const fp2 = computeBlockFingerprint(
			makeBlock({ classes: ["ai-answer", "css-a1b2c3d4e5"] }),
		);
		expect(fp1).toBe(fp2);
	});

	it("changes when tag changes", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ tagName: "DIV" }));
		const fp2 = computeBlockFingerprint(makeBlock({ tagName: "SECTION" }));
		expect(fp1).not.toBe(fp2);
	});

	it("changes when text content changes", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ textContent: "AI answer" }));
		const fp2 = computeBlockFingerprint(makeBlock({ textContent: "Shopping deals" }));
		expect(fp1).not.toBe(fp2);
	});

	it("is stable with whitespace variations in text", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ textContent: "AI  answer   here" }));
		const fp2 = computeBlockFingerprint(makeBlock({ textContent: "AI answer here" }));
		expect(fp1).toBe(fp2);
	});

	it("truncates long text to 100 chars", () => {
		const longText = "a".repeat(200);
		const fp1 = computeBlockFingerprint(makeBlock({ textContent: longText }));
		const fp2 = computeBlockFingerprint(
			makeBlock({ textContent: longText.slice(0, 100) + "DIFFERENT" }),
		);
		// Both truncate to first 100 chars which are same
		expect(fp1).toBe(fp2);
	});

	it("changes when depth changes", () => {
		const fp1 = computeBlockFingerprint(makeBlock({ depth: 3 }));
		const fp2 = computeBlockFingerprint(makeBlock({ depth: 5 }));
		expect(fp1).not.toBe(fp2);
	});

	it("handles null role and ariaLabel", () => {
		const fp = computeBlockFingerprint(makeBlock({ role: null, ariaLabel: null }));
		expect(fp).toMatch(/^[a-f0-9]{16}$/);
	});
});
