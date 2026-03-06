import { Hono } from "hono";
import { BASELINE_DENY_LABELS, BASELINE_REFRESH_LABELS } from "../../../configs/baselines";
import { SUPPRESSION_TTL_MS } from "../../../configs/suppression";
import type { Env } from "../index";
import { getWeekKey } from "./report";

export function webhookRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/** GitHub webhook: issues event */
	router.post("/github", async (c) => {
		const event = c.req.header("X-GitHub-Event");
		if (event !== "issues") {
			return c.json({ skipped: true, reason: `event: ${event}` });
		}

		const payload = await c.req.json();
		const action: string = payload.action;

		if (action !== "closed" && action !== "labeled") {
			return c.json({ skipped: true, reason: `action: ${action}` });
		}

		const labels: string[] = (payload.issue?.labels ?? []).map(
			(l: { name: string }) => l.name,
		);

		// Only process ai-scout issues
		if (!labels.includes("ai-scout")) {
			return c.json({ skipped: true, reason: "not ai-scout issue" });
		}

		const issueNumber: number = payload.issue.number;

		// Extract fingerprint from issue body (stored as metadata comment)
		const body: string = payload.issue.body ?? "";
		const fpMatch = body.match(/<!-- scout-fingerprint: ([a-f0-9]+) -->/);
		const blockFingerprint = fpMatch?.[1];

		const profileMatch = body.match(/<!-- scout-profile: (.+?) -->/);
		const profileKey = profileMatch?.[1];

		if (action === "closed" && blockFingerprint) {
			// Check if labels allow baseline refresh
			const allowRefresh = labels.some((l) =>
				(BASELINE_REFRESH_LABELS as readonly string[]).includes(l),
			);
			const isFalsePositive = labels.some((l) =>
				(BASELINE_DENY_LABELS as readonly string[]).includes(l),
			);

			// Update fingerprint → issue mapping
			const fpKey = `fingerprint:${blockFingerprint}`;
			const existing = await c.env.STATE.get(fpKey);
			if (existing) {
				const data = JSON.parse(existing);
				data.issueOpen = false;
				data.resolution = labels;
				await c.env.STATE.put(fpKey, JSON.stringify(data));
			}

			// Handle false-positive suppression
			if (isFalsePositive) {
				const surfaceMatch = body.match(/<!-- scout-surface: (.+?) -->/);
				const feedbackKey = `feedback:${blockFingerprint}`;
				await c.env.STATE.put(
					feedbackKey,
					JSON.stringify({
						blockFingerprint,
						resolution: labels.find((l) =>
							(BASELINE_DENY_LABELS as readonly string[]).includes(l),
						),
						surface: surfaceMatch?.[1] ?? "unknown",
						scope: "ttl",
						createdAt: new Date().toISOString(),
						expiresAt: new Date(Date.now() + SUPPRESSION_TTL_MS).toISOString(),
					}),
				);
			}

			// Handle baseline promotion
			if (allowRefresh && profileKey) {
				const candidateKey = `baseline:${profileKey}:candidate`;
				const stableKey = `baseline:${profileKey}`;
				const candidate = await c.env.STATE.get(candidateKey);
				if (candidate) {
					await c.env.STATE.put(stableKey, candidate);
					await c.env.STATE.delete(candidateKey);
				}
			}

			// Increment global weekly "fixed" counter
			if (labels.includes("fixed") || allowRefresh) {
				const weekKey = `week:${getWeekKey()}:global`;
				const weekRaw = await c.env.STATE.get(weekKey);
				const week = weekRaw
					? JSON.parse(weekRaw) as { reported: number; issued: number; fixed: number }
					: { reported: 0, issued: 0, fixed: 0 };
				week.fixed++;
				await c.env.STATE.put(weekKey, JSON.stringify(week), { expirationTtl: 14 * 24 * 60 * 60 });
			}

			return c.json({
				ok: true,
				issueNumber,
				baselineRefreshed: allowRefresh && !!profileKey,
				suppressed: isFalsePositive,
			});
		}

		return c.json({ ok: true, action });
	});

	return router;
}
