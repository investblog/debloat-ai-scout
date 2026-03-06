import { Hono } from "hono";
import type { Env } from "../index";

export function dedupRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/** Check if a fingerprint already has an open issue or is suppressed */
	router.get("/check/:fingerprint", async (c) => {
		const fingerprint = c.req.param("fingerprint");

		// Check suppression (false-positive feedback)
		const feedbackKey = `feedback:${fingerprint}`;
		const feedback = await c.env.STATE.get(feedbackKey);
		if (feedback) {
			const entry = JSON.parse(feedback);
			// Check TTL
			if (entry.scope === "permanent" || (entry.expiresAt && new Date(entry.expiresAt) > new Date())) {
				return c.json({ duplicate: true, reason: "suppressed", entry });
			}
			// Expired TTL — clean up
			await c.env.STATE.delete(feedbackKey);
		}

		// Check existing fingerprint → issue mapping
		const fpKey = `fingerprint:${fingerprint}`;
		const existing = await c.env.STATE.get(fpKey);
		if (existing) {
			const data = JSON.parse(existing);
			if (data.issueNumber && data.issueOpen) {
				return c.json({ duplicate: true, reason: "open_issue", issueNumber: data.issueNumber });
			}
		}

		return c.json({ duplicate: false });
	});

	/** Batch dedup check */
	router.post("/check-batch", async (c) => {
		const { fingerprints }: { fingerprints: string[] } = await c.req.json();
		const results: Record<string, { duplicate: boolean; reason?: string }> = {};

		for (const fp of fingerprints) {
			// Check suppression
			const feedbackKey = `feedback:${fp}`;
			const feedback = await c.env.STATE.get(feedbackKey);
			if (feedback) {
				const entry = JSON.parse(feedback);
				if (entry.scope === "permanent" || (entry.expiresAt && new Date(entry.expiresAt) > new Date())) {
					results[fp] = { duplicate: true, reason: "suppressed" };
					continue;
				}
			}

			// Check existing issue
			const fpKey = `fingerprint:${fp}`;
			const existing = await c.env.STATE.get(fpKey);
			if (existing) {
				const data = JSON.parse(existing);
				if (data.issueNumber && data.issueOpen) {
					results[fp] = { duplicate: true, reason: "open_issue" };
					continue;
				}
			}

			results[fp] = { duplicate: false };
		}

		return c.json(results);
	});

	return router;
}
