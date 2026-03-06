import { describe, expect, it } from "vitest";
import type { CandidateBlock } from "@/shared/types";
import { detectAndScore } from "./heuristic";

function makeBlock(overrides: Partial<CandidateBlock> = {}): CandidateBlock {
	return {
		html: "<div>test</div>",
		selector: "div.test",
		textContent: "",
		tagName: "DIV",
		classes: [],
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

describe("detectAndScore", () => {
	it("returns scored candidates", () => {
		const results = detectAndScore([makeBlock()]);
		expect(results).toHaveLength(1);
		expect(results[0]).toHaveProperty("totalScore");
		expect(results[0]).toHaveProperty("blockFingerprint");
		expect(results[0]).toHaveProperty("layoutFingerprint");
	});

	it("detects AI keywords in text content", () => {
		const results = detectAndScore([
			makeBlock({ textContent: "Copilot can help you write code" }),
		]);
		const signals = results[0]!.signals;
		expect(signals.some((s) => s.type === "keyword" && s.value.includes("copilot"))).toBe(
			true,
		);
	});

	it("detects AI keywords in aria-label", () => {
		const results = detectAndScore([makeBlock({ ariaLabel: "AI Assistant panel" })]);
		const signals = results[0]!.signals;
		expect(signals.some((s) => s.type === "keyword")).toBe(true);
	});

	it("detects AI keywords in class names", () => {
		const results = detectAndScore([makeBlock({ classes: ["gemini-answer-block"] })]);
		const signals = results[0]!.signals;
		expect(signals.some((s) => s.type === "keyword" && s.value.includes("gemini"))).toBe(
			true,
		);
	});

	it("detects top placement", () => {
		const results = detectAndScore([
			makeBlock({ boundingBox: { x: 0, y: 50, width: 800, height: 200 } }),
		]);
		expect(results[0]!.signals.some((s) => s.type === "placement")).toBe(true);
	});

	it("does not flag bottom placement", () => {
		const results = detectAndScore([
			makeBlock({ boundingBox: { x: 0, y: 600, width: 800, height: 200 } }),
		]);
		expect(results[0]!.signals.some((s) => s.type === "placement")).toBe(false);
	});

	it("detects action buttons", () => {
		const results = detectAndScore([
			makeBlock({ textContent: "Summarize this page for me" }),
		]);
		expect(results[0]!.signals.some((s) => s.type === "action_button")).toBe(true);
	});

	it("detects shadow DOM", () => {
		const results = detectAndScore([makeBlock({ inShadowDom: true })]);
		expect(results[0]!.signals.some((s) => s.type === "shadow_dom")).toBe(true);
	});

	it("classifies as AI when AI keywords dominate", () => {
		const results = detectAndScore([
			makeBlock({ textContent: "AI copilot assistant helps you" }),
		]);
		expect(results[0]!.category).toBe("ai");
	});

	it("classifies as unknown_candidate when no keywords match", () => {
		const results = detectAndScore([makeBlock({ textContent: "Weather forecast today" })]);
		expect(results[0]!.category).toBe("unknown_candidate");
	});

	it("produces high score for obvious AI block", () => {
		const results = detectAndScore([
			makeBlock({
				textContent: "Copilot answer: try summarize this",
				boundingBox: { x: 0, y: 50, width: 800, height: 300 },
				inShadowDom: true,
			}),
		]);
		// keyword(3) + placement(2) + action_button(2) + shadow_dom(1) = 8
		expect(results[0]!.totalScore).toBeGreaterThanOrEqual(6);
	});

	it("produces low score for non-AI block", () => {
		const results = detectAndScore([
			makeBlock({
				textContent: "Latest news articles",
				boundingBox: { x: 0, y: 600, width: 800, height: 200 },
			}),
		]);
		expect(results[0]!.totalScore).toBeLessThan(4);
	});

	it("generates fingerprints for each candidate", () => {
		const results = detectAndScore([makeBlock(), makeBlock({ tagName: "SECTION" })]);
		expect(results[0]!.blockFingerprint).toMatch(/^[a-f0-9]{16}$/);
		expect(results[1]!.blockFingerprint).toMatch(/^[a-f0-9]{16}$/);
		expect(results[0]!.blockFingerprint).not.toBe(results[1]!.blockFingerprint);
	});
});
