import { Hono } from "hono";
import type { Env } from "../index";

interface ScanResultPayload {
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
}

export function scanRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/** Receive scan results from GHA crawler */
	router.post("/results", async (c) => {
		const payload: ScanResultPayload = await c.req.json();

		// Store fingerprints in KV for dedup
		for (const candidate of payload.candidates) {
			const fpKey = `fingerprint:${candidate.blockFingerprint}`;
			const existing = await c.env.STATE.get(fpKey);
			if (!existing) {
				await c.env.STATE.put(
					fpKey,
					JSON.stringify({
						firstSeen: payload.timestamp,
						lastSeen: payload.timestamp,
						surface: payload.surface,
						browser: payload.browser,
						locale: payload.locale,
						score: candidate.score,
						category: candidate.category,
					}),
				);
			} else {
				const data = JSON.parse(existing);
				data.lastSeen = payload.timestamp;
				data.score = candidate.score;
				await c.env.STATE.put(fpKey, JSON.stringify(data));
			}
		}

		// Store run metadata in R2
		const r2Key = `${payload.surface}/${payload.browser}/${payload.locale}/${payload.timestamp}/${payload.runId}/run.json`;
		await c.env.ARTIFACTS.put(r2Key, JSON.stringify(payload));

		return c.json({
			ok: true,
			stored: payload.candidates.length,
			runId: payload.runId,
		});
	});

	/** Upload screenshot to R2 */
	router.post("/screenshot", async (c) => {
		const formData = await c.req.formData();
		const file = formData.get("file") as File | null;
		const r2Path = formData.get("path") as string | null;

		if (!file || !r2Path) {
			return c.json({ error: "Missing file or path" }, 400);
		}

		await c.env.ARTIFACTS.put(r2Path, file.stream(), {
			httpMetadata: { contentType: file.type },
		});

		return c.json({ ok: true, path: r2Path });
	});

	/** Get signed URL for a screenshot */
	router.get("/screenshot/:path{.+}", async (c) => {
		const path = c.req.param("path");
		const object = await c.env.ARTIFACTS.get(path);

		if (!object) {
			return c.json({ error: "Not found" }, 404);
		}

		return new Response(object.body, {
			headers: {
				"Content-Type": object.httpMetadata?.contentType ?? "image/png",
				"Cache-Control": "public, max-age=86400",
			},
		});
	});

	return router;
}
