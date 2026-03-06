import { describe, expect, it } from "vitest";
import type { CandidateBlock } from "@/shared/types";
import { computeLayoutFingerprint } from "./layout";

function makeBlock(overrides: Partial<CandidateBlock> = {}): CandidateBlock {
	return {
		html: "<div>test</div>",
		selector: "div.test",
		textContent: "Hello AI",
		tagName: "DIV",
		classes: ["ai-answer"],
		role: null,
		ariaLabel: null,
		depth: 3,
		parentTag: "MAIN",
		siblingCount: 2,
		boundingBox: { x: 0, y: 100, width: 800, height: 200 },
		inShadowDom: false,
		...overrides,
	};
}

describe("computeLayoutFingerprint", () => {
	it("produces a hex string", () => {
		const fp = computeLayoutFingerprint(makeBlock());
		expect(fp).toMatch(/^[a-f0-9]{16}$/);
	});

	it("is deterministic", () => {
		const block = makeBlock();
		expect(computeLayoutFingerprint(block)).toBe(computeLayoutFingerprint(block));
	});

	it("same zone → same fingerprint despite different content", () => {
		const fp1 = computeLayoutFingerprint(
			makeBlock({ textContent: "AI answer", classes: ["ai-block"] }),
		);
		const fp2 = computeLayoutFingerprint(
			makeBlock({ textContent: "Copilot response", classes: ["copilot"] }),
		);
		// Same zone (top), same parent, same depth → same layout fingerprint
		expect(fp1).toBe(fp2);
	});

	it("different vertical zone → different fingerprint", () => {
		const fpTop = computeLayoutFingerprint(
			makeBlock({ boundingBox: { x: 0, y: 50, width: 800, height: 100 } }),
		);
		const fpBottom = computeLayoutFingerprint(
			makeBlock({ boundingBox: { x: 0, y: 600, width: 800, height: 100 } }),
		);
		expect(fpTop).not.toBe(fpBottom);
	});

	it("classifies zones: top < 200, middle 200-500, bottom > 500", () => {
		const fpTop = computeLayoutFingerprint(
			makeBlock({ boundingBox: { x: 0, y: 0, width: 800, height: 100 } }),
		);
		const fpMiddle = computeLayoutFingerprint(
			makeBlock({ boundingBox: { x: 0, y: 250, width: 800, height: 100 } }),
		);
		const fpBottom = computeLayoutFingerprint(
			makeBlock({ boundingBox: { x: 0, y: 550, width: 800, height: 100 } }),
		);
		expect(fpTop).not.toBe(fpMiddle);
		expect(fpMiddle).not.toBe(fpBottom);
		expect(fpTop).not.toBe(fpBottom);
	});

	it("shadow DOM vs light DOM → different fingerprint", () => {
		const fpLight = computeLayoutFingerprint(makeBlock({ inShadowDom: false }));
		const fpShadow = computeLayoutFingerprint(makeBlock({ inShadowDom: true }));
		expect(fpLight).not.toBe(fpShadow);
	});

	it("handles null boundingBox", () => {
		const fp = computeLayoutFingerprint(makeBlock({ boundingBox: null }));
		expect(fp).toMatch(/^[a-f0-9]{16}$/);
	});
});
