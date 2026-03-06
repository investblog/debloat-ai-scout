import type { BaselineEntry, ScoredCandidate } from "@/shared/types";

/**
 * Client for the CF Worker API.
 * Used by the GHA scan pipeline to interact with state.
 */
export class WorkerClient {
	constructor(private baseUrl: string) {}

	/** Fetch stable baseline for a profile */
	async getBaseline(profileKey: string): Promise<BaselineEntry | null> {
		const res = await fetch(`${this.baseUrl}/baseline/${encodeURIComponent(profileKey)}`);
		if (res.status === 404) return null;
		if (!res.ok) throw new Error(`getBaseline failed: ${res.status}`);
		return res.json();
	}

	/** Store stable baseline */
	async putBaseline(profileKey: string, baseline: BaselineEntry): Promise<void> {
		const res = await fetch(`${this.baseUrl}/baseline/${encodeURIComponent(profileKey)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(baseline),
		});
		if (!res.ok) throw new Error(`putBaseline failed: ${res.status}`);
	}

	/** Store candidate baseline (pending promotion) */
	async putCandidateBaseline(profileKey: string, baseline: BaselineEntry): Promise<void> {
		const res = await fetch(
			`${this.baseUrl}/baseline/${encodeURIComponent(profileKey)}/candidate`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(baseline),
			},
		);
		if (!res.ok) throw new Error(`putCandidateBaseline failed: ${res.status}`);
	}

	/** Upload screenshot to R2 */
	async uploadScreenshot(buffer: Buffer, path: string): Promise<string> {
		const formData = new FormData();
		formData.append("file", new Blob([buffer], { type: "image/png" }), "screenshot.png");
		formData.append("path", path);

		const res = await fetch(`${this.baseUrl}/scan/screenshot`, {
			method: "POST",
			body: formData,
		});
		if (!res.ok) throw new Error(`uploadScreenshot failed: ${res.status}`);
		return `${this.baseUrl}/scan/screenshot/${path}`;
	}

	/** Push scan results (fingerprints, metadata) */
	async pushScanResults(payload: {
		runId: string;
		profileKey: string;
		surface: string;
		browser: string;
		locale: string;
		timestamp: string;
		candidates: Array<{
			blockFingerprint: string;
			layoutFingerprint: string;
			score: number;
			category: string;
			domSnippet: string;
			signals: Array<{ type: string; value: string; score: number }>;
		}>;
	}): Promise<void> {
		const res = await fetch(`${this.baseUrl}/scan/results`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) throw new Error(`pushScanResults failed: ${res.status}`);
	}

	/** Batch dedup check */
	async checkDedup(
		fingerprints: string[],
	): Promise<Record<string, { duplicate: boolean; reason?: string }>> {
		const res = await fetch(`${this.baseUrl}/dedup/check-batch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ fingerprints }),
		});
		if (!res.ok) throw new Error(`checkDedup failed: ${res.status}`);
		return res.json();
	}
}
