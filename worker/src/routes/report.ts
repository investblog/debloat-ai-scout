import { Hono } from "hono";
import type { Env } from "../index";
import type { ExtensionReport, CandidateBlock, BaselineEntry } from "../../../src/shared/types";
import { detectAndScore } from "../../../src/detectors/heuristic";
import { applyFilters } from "../../../src/detectors/filters";
import { filterActionable } from "../../../src/scoring";
import { diffAgainstBaseline, buildBaseline } from "../../../src/baseline/diff";

interface IssuePayload {
	title: string;
	body: string;
	labels: string[];
}

export function reportRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/**
	 * Receive a report from the Debloat browser extension.
	 * Runs the full pipeline: score → filter → baseline diff → dedup → issue.
	 */
	router.post("/", async (c) => {
		const report: ExtensionReport = await c.req.json();

		// Validate required fields
		if (!report.surface || !report.browser || !report.candidates) {
			return c.json({ error: "Missing required fields: surface, browser, candidates" }, 400);
		}

		if (report.candidates.length === 0) {
			return c.json({ ok: true, result: "no_candidates", issued: 0 });
		}

		const profileKey = `${report.surface}:${report.browser}:${report.locale}`;
		const runId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

		// 1. Detect & score
		const scored = detectAndScore(report.candidates);

		// 2. Filter (structural, organic, nested)
		const filtered = applyFilters(report.candidates, scored);

		// 3. Actionable only
		const actionable = filterActionable(filtered);

		if (actionable.length === 0) {
			return c.json({
				ok: true,
				result: "all_filtered",
				raw: report.candidates.length,
				scored: scored.length,
				filtered: filtered.length,
				actionable: 0,
				issued: 0,
			});
		}

		// 4. Baseline diff
		const baselineKey = `baseline:${profileKey}`;
		const baselineRaw = await c.env.STATE.get(baselineKey);
		const baseline: BaselineEntry | null = baselineRaw ? JSON.parse(baselineRaw) : null;
		const diff = diffAgainstBaseline(actionable, baseline);

		// Only new and changed findings create issues
		const issueWorthy = [...diff.added, ...diff.changed.map((ch) => ch.current)];

		// 5. Dedup check
		const novel = [];
		for (const candidate of issueWorthy) {
			// Check suppression
			const feedbackKey = `feedback:${candidate.blockFingerprint}`;
			const feedback = await c.env.STATE.get(feedbackKey);
			if (feedback) {
				const entry = JSON.parse(feedback);
				if (entry.scope === "permanent" || (entry.expiresAt && new Date(entry.expiresAt) > new Date())) {
					continue; // Suppressed
				}
			}

			// Check existing open issue
			const fpKey = `fingerprint:${candidate.blockFingerprint}`;
			const existing = await c.env.STATE.get(fpKey);
			if (existing) {
				const data = JSON.parse(existing);
				if (data.issueNumber && data.issueOpen) {
					continue; // Already has open issue
				}
			}

			novel.push(candidate);
		}

		// 6. Create GitHub issues for novel findings
		let issued = 0;
		const errors: string[] = [];
		const hasToken = !!c.env.GITHUB_TOKEN;

		if (novel.length > 0 && hasToken) {
			for (const candidate of novel) {
				const issue = buildIssuePayload(candidate, report);
				try {
					const result = await createGitHubIssue(
						issue,
						c.env.GITHUB_REPO_OWNER,
						c.env.GITHUB_REPO_NAME,
						c.env.GITHUB_TOKEN!,
					);

					// Store fingerprint → issue mapping
					const fpKey = `fingerprint:${candidate.blockFingerprint}`;
					await c.env.STATE.put(fpKey, JSON.stringify({
						firstSeen: new Date().toISOString(),
						lastSeen: new Date().toISOString(),
						surface: report.surface,
						browser: report.browser,
						locale: report.locale,
						score: candidate.totalScore,
						category: candidate.category,
						issueNumber: result.number,
						issueOpen: true,
					}));

					issued++;
				} catch (err) {
					errors.push(err instanceof Error ? err.message : String(err));
				}
			}
		}

		// 7. Update baseline
		if (diff.isFirstScan || diff.added.length > 0 || diff.changed.length > 0) {
			const snapshot = {
				url: report.pageUrl,
				title: report.surface,
				timestamp: new Date().toISOString(),
				reducedHtml: "",
			};
			const newBaseline = buildBaseline(profileKey, actionable, snapshot, runId);

			if (diff.isFirstScan) {
				await c.env.STATE.put(baselineKey, JSON.stringify(newBaseline));
			} else {
				await c.env.STATE.put(`${baselineKey}:candidate`, JSON.stringify(newBaseline));
			}
		}

		// 8. Store scan metadata
		const scanKey = `scan:${runId}`;
		await c.env.STATE.put(scanKey, JSON.stringify({
			runId,
			profileKey,
			source: "extension",
			extensionVersion: report.extensionVersion,
			timestamp: new Date().toISOString(),
			raw: report.candidates.length,
			actionable: actionable.length,
			novel: novel.length,
			issued,
			hiddenCount: report.hiddenCount,
		}), { expirationTtl: 7 * 24 * 60 * 60 }); // 7 day TTL

		const result = issued > 0
			? "issues_created"
			: !hasToken
				? "no_github_token"
				: errors.length > 0
					? "issue_creation_failed"
					: novel.length > 0
						? "deduped"
						: "no_novel";

		return c.json({
			ok: true,
			result,
			...(errors.length > 0 && { errors }),
			raw: report.candidates.length,
			scored: scored.length,
			filtered: filtered.length,
			actionable: actionable.length,
			novel: novel.length,
			issued,
			isFirstScan: diff.isFirstScan,
		});
	});

	return router;
}

function buildIssuePayload(
	candidate: ReturnType<typeof detectAndScore>[number],
	report: ExtensionReport,
): IssuePayload {
	const signals = candidate.signals
		.map((s) => `- **${s.type}**: \`${s.value}\` (+${s.score})`)
		.join("\n");

	const body = `## AI Scout Detection (Extension Report)

| Field | Value |
|---|---|
| **Surface** | ${report.surface} |
| **Browser** | ${report.browser} |
| **Locale** | ${report.locale} |
| **Extension** | v${report.extensionVersion} |
| **Category** | \`${candidate.category}\` |
| **Score** | ${candidate.totalScore}/10 |
| **Source** | Extension telemetry |

## Signals

${signals || "No specific signals detected."}

## DOM Snippet

\`\`\`html
${candidate.block.html.slice(0, 1500)}
\`\`\`

## Element Info

- **Selector**: \`${candidate.block.selector}\`
- **Tag**: \`${candidate.block.tagName}\`
- **Classes**: \`${candidate.block.classes.join(", ")}\`
- **Depth**: ${candidate.block.depth}
- **Shadow DOM**: ${candidate.block.inShadowDom ? "Yes" : "No"}

## Suggested Action

Review the detected element and add appropriate CSS selectors to \`src/selectors/\` if it should be hidden by Debloat.

---

<!-- scout-fingerprint: ${candidate.blockFingerprint} -->
<!-- scout-layout: ${candidate.layoutFingerprint} -->
<!-- scout-surface: ${report.surface} -->
<!-- scout-profile: ${report.surface}:${report.browser}:${report.locale} -->
*Reported by Debloat extension v${report.extensionVersion}*`;

	const labels = candidate.totalScore >= 6
		? ["ai-scout", "needs-human-review"]
		: ["ai-scout", "needs-human-review"];

	return {
		title: `[AI Scout] New ${candidate.category} element on ${report.surface} (${report.browser}/${report.locale})`,
		body,
		labels,
	};
}

async function createGitHubIssue(
	issue: IssuePayload,
	owner: string,
	repo: string,
	token: string,
): Promise<{ number: number; url: string }> {
	const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
		method: "POST",
		headers: {
			Authorization: `token ${token}`,
			"Content-Type": "application/json",
			Accept: "application/vnd.github+json",
			"User-Agent": "debloat-ai-scout-worker",
		},
		body: JSON.stringify(issue),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`GitHub API error ${response.status}: ${text}`);
	}

	const data = await response.json() as { number: number; html_url: string };
	return { number: data.number, url: data.html_url };
}
