import { Hono } from "hono";
import type { Env } from "../index";
import type {
	ExtensionReport,
	BaselineEntry,
	ReportResponse,
	ScoutNotification,
	InstallStats,
} from "../../../src/shared/types";
import { detectAndScore } from "../../../src/detectors/heuristic";
import { applyFilters } from "../../../src/detectors/filters";
import { filterActionable } from "../../../src/scoring";
import { diffAgainstBaseline, buildBaseline } from "../../../src/baseline/diff";

/** Surface display names for notifications */
const SURFACE_NAMES: Record<string, string> = {
	"google-search": "Google Search",
	"bing-search": "Bing Search",
	"edge-ntp": "Edge New Tab",
	"firefox-home": "Firefox Home",
};

interface IssuePayload {
	title: string;
	body: string;
	labels: string[];
}

interface CreatedIssue {
	number: number;
	url: string;
}

export function reportRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/**
	 * Receive a report from the Debloat browser extension.
	 * Runs: score → filter → baseline diff → dedup → issue → stats → notification.
	 */
	router.post("/", async (c) => {
		const report: ExtensionReport = await c.req.json();

		if (!report.surface || !report.browser || !report.candidates) {
			return c.json({ error: "Missing required fields" }, 400);
		}

		const surfaceName = SURFACE_NAMES[report.surface] ?? report.surface;

		// Empty report — quick response
		if (report.candidates.length === 0) {
			const resp: ReportResponse = {
				ok: true,
				result: "no_candidates",
				raw: 0,
				actionable: 0,
				novel: 0,
				issued: 0,
				isFirstScan: false,
				issues: [],
				notification: {
					title: "Debloat Scout",
					message: `${surfaceName}: report received — no elements found`,
					context: "",
				},
			};
			await updateStats(c.env.STATE, report.installId, report.surface, 0);
			return c.json(resp);
		}

		const profileKey = `${report.surface}:${report.browser}:${report.locale}`;
		const runId = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

		// 1. Detect & score
		const scored = detectAndScore(report.candidates);

		// 2. Filter
		const filtered = applyFilters(report.candidates, scored);
		const actionable = filterActionable(filtered);

		if (actionable.length === 0) {
			const resp: ReportResponse = {
				ok: true,
				result: "all_filtered",
				raw: report.candidates.length,
				actionable: 0,
				novel: 0,
				issued: 0,
				isFirstScan: false,
				issues: [],
				notification: {
					title: "Debloat Scout",
					message: `${surfaceName}: report received — no new elements`,
					context: `${report.candidates.length} checked`,
				},
			};
			await updateStats(c.env.STATE, report.installId, report.surface, 0);
			return c.json(resp);
		}

		// 3. Baseline diff
		const baselineKey = `baseline:${profileKey}`;
		const baselineRaw = await c.env.STATE.get(baselineKey);
		const baseline: BaselineEntry | null = baselineRaw ? JSON.parse(baselineRaw) : null;
		const diff = diffAgainstBaseline(actionable, baseline);
		const issueWorthy = [...diff.added, ...diff.changed.map((ch) => ch.current)];

		// 4. Dedup
		const novel = [];
		for (const candidate of issueWorthy) {
			const feedbackKey = `feedback:${candidate.blockFingerprint}`;
			const feedback = await c.env.STATE.get(feedbackKey);
			if (feedback) {
				const entry = JSON.parse(feedback);
				if (entry.scope === "permanent" || (entry.expiresAt && new Date(entry.expiresAt) > new Date())) {
					continue;
				}
			}
			const fpKey = `fingerprint:${candidate.blockFingerprint}`;
			const existing = await c.env.STATE.get(fpKey);
			if (existing) {
				const data = JSON.parse(existing);
				if (data.issueNumber && data.issueOpen) continue;
			}
			novel.push(candidate);
		}

		// 5. Create issues
		const createdIssues: CreatedIssue[] = [];
		const errors: string[] = [];

		if (novel.length > 0 && c.env.GITHUB_TOKEN) {
			for (const candidate of novel) {
				const issue = buildIssuePayload(candidate, report);
				try {
					const created = await createGitHubIssue(
						issue,
						c.env.GITHUB_REPO_OWNER,
						c.env.GITHUB_REPO_NAME,
						c.env.GITHUB_TOKEN,
					);
					createdIssues.push(created);

					const fpKey = `fingerprint:${candidate.blockFingerprint}`;
					await c.env.STATE.put(fpKey, JSON.stringify({
						firstSeen: new Date().toISOString(),
						lastSeen: new Date().toISOString(),
						surface: report.surface,
						browser: report.browser,
						locale: report.locale,
						score: candidate.totalScore,
						category: candidate.category,
						issueNumber: created.number,
						issueOpen: true,
					}));
				} catch (err) {
					errors.push(err instanceof Error ? err.message : String(err));
				}
			}
		}

		// 6. Update baseline
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

		// 7. Store scan metadata
		await c.env.STATE.put(`scan:${runId}`, JSON.stringify({
			runId,
			profileKey,
			installId: report.installId,
			source: "extension",
			extensionVersion: report.extensionVersion,
			timestamp: new Date().toISOString(),
			raw: report.candidates.length,
			actionable: actionable.length,
			novel: novel.length,
			issued: createdIssues.length,
			hiddenCount: report.hiddenCount,
		}), { expirationTtl: 7 * 24 * 60 * 60 });

		// 8. Update stats
		await updateStats(c.env.STATE, report.installId, report.surface, createdIssues.length);

		// 9. Build result & notification
		const result = resolveResult(diff.isFirstScan, createdIssues.length, novel.length, errors.length, !!c.env.GITHUB_TOKEN);
		const notification = buildNotification(result, surfaceName, report, actionable.length, createdIssues);

		const resp: ReportResponse = {
			ok: true,
			result,
			raw: report.candidates.length,
			actionable: actionable.length,
			novel: novel.length,
			issued: createdIssues.length,
			isFirstScan: diff.isFirstScan,
			issues: createdIssues,
			notification,
			...(errors.length > 0 && { errors }),
		};

		return c.json(resp);
	});

	return router;
}

// --- Stats ---

async function updateStats(kv: KVNamespace, installId: string | undefined, surface: string, issued: number): Promise<void> {
	const now = new Date().toISOString();
	const weekKey = getWeekKey();

	// Per-installation stats
	if (installId) {
		const key = `stats:${installId}`;
		const raw = await kv.get(key);
		const stats: InstallStats = raw
			? JSON.parse(raw)
			: { reported: 0, issued: 0, lastReport: now, firstReport: now, surfaces: [] };

		stats.reported++;
		stats.issued += issued;
		stats.lastReport = now;
		if (!stats.surfaces.includes(surface)) {
			stats.surfaces.push(surface);
		}
		await kv.put(key, JSON.stringify(stats));

		// Per-installation weekly stats
		const weekUserKey = `week:${weekKey}:${installId}`;
		const weekUserRaw = await kv.get(weekUserKey);
		const weekUser = weekUserRaw
			? JSON.parse(weekUserRaw) as { reported: number; issued: number }
			: { reported: 0, issued: 0 };
		weekUser.reported++;
		weekUser.issued += issued;
		await kv.put(weekUserKey, JSON.stringify(weekUser), { expirationTtl: 14 * 24 * 60 * 60 });
	}

	// Global weekly stats
	const weekGlobalKey = `week:${weekKey}:global`;
	const weekGlobalRaw = await kv.get(weekGlobalKey);
	const weekGlobal = weekGlobalRaw
		? JSON.parse(weekGlobalRaw) as { reported: number; issued: number; fixed: number }
		: { reported: 0, issued: 0, fixed: 0 };
	weekGlobal.reported++;
	weekGlobal.issued += issued;
	await kv.put(weekGlobalKey, JSON.stringify(weekGlobal), { expirationTtl: 14 * 24 * 60 * 60 });
}

/** ISO week key: "2026-W10" */
function getWeekKey(date = new Date()): string {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// --- Result classification ---

type ResultType = ReportResponse["result"];

function resolveResult(
	isFirstScan: boolean,
	issued: number,
	novel: number,
	errorCount: number,
	hasToken: boolean,
): ResultType {
	if (isFirstScan) return "first_scan";
	if (issued > 0) return "issues_created";
	if (errorCount > 0) return "issue_creation_failed";
	if (!hasToken && novel > 0) return "no_github_token";
	if (novel > 0) return "deduped";
	return "no_novel";
}

// --- Notification builder ---

function buildNotification(
	result: ResultType,
	surfaceName: string,
	report: ExtensionReport,
	actionable: number,
	issues: CreatedIssue[],
): ScoutNotification {
	const ctx = `${report.browser} · ${report.locale}`;

	switch (result) {
		case "issues_created": {
			const nums = issues.map((i) => `#${i.number}`).join(", ");
			const msg = issues.length === 1
				? `${surfaceName}: new AI element → Issue ${nums}`
				: `${surfaceName}: ${issues.length} new elements → Issues ${nums}`;
			return {
				title: "Debloat Scout",
				message: msg,
				context: ctx,
				issueUrl: issues[0]?.url,
			};
		}
		case "first_scan":
			return {
				title: "Debloat Scout",
				message: `${surfaceName}: baseline established for tracking`,
				context: `${actionable} element(s) recorded · ${ctx}`,
			};
		case "no_novel":
			return {
				title: "Debloat Scout",
				message: `${surfaceName}: ${actionable} elements checked — all known ✓`,
				context: ctx,
			};
		case "deduped":
			return {
				title: "Debloat Scout",
				message: `${surfaceName}: element already reported ✓`,
				context: ctx,
			};
		case "all_filtered":
			return {
				title: "Debloat Scout",
				message: `${surfaceName}: report received — no new elements`,
				context: ctx,
			};
		case "issue_creation_failed":
			return {
				title: "Debloat Scout",
				message: `${surfaceName}: found new element, issue pending`,
				context: ctx,
			};
		default:
			return {
				title: "Debloat Scout",
				message: `${surfaceName}: report received`,
				context: ctx,
			};
	}
}

// --- Issue builder ---

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

	return {
		title: `[AI Scout] New ${candidate.category} element on ${report.surface} (${report.browser}/${report.locale})`,
		body,
		labels: ["ai-scout", "needs-human-review"],
	};
}

// --- GitHub API ---

async function createGitHubIssue(
	issue: IssuePayload,
	owner: string,
	repo: string,
	token: string,
): Promise<CreatedIssue> {
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
		throw new Error(`GitHub API ${response.status}: ${text}`);
	}

	const data = await response.json() as { number: number; html_url: string };
	return { number: data.number, url: data.html_url };
}

// Export for digest route
export { getWeekKey };
