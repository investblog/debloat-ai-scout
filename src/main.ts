/**
 * Debloat AI Scout — main entry point
 *
 * Executed by GHA cron or manually via `npm run scan`.
 * Pipeline: crawl → detect → score → dedup → issue
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AI_KEYWORDS } from "@configs/keywords";
import { loadSurfaces } from "@configs/surfaces";
import { crawlAll, type CrawlResult } from "@/crawler";
import { detectAndScore } from "@/detectors/heuristic";
import { filterActionable } from "@/scoring";
import { composeIssue, createGitHubIssue, formatIssueBody } from "@/github/issues";

const WORKER_URL = process.env.WORKER_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "investblog";
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? "debloat";

async function main() {
	const surfaces = loadSurfaces(1); // P1 only for MVP
	console.log(`[scout] Starting scan for ${surfaces.length} surface(s)...`);

	// 1. Crawl all surfaces
	const { results, runId } = await crawlAll(surfaces, AI_KEYWORDS);
	console.log(`[scout] Crawl complete. Run ID: ${runId}`);

	// Save artifacts locally
	const artifactsDir = join("artifacts", runId);
	await mkdir(artifactsDir, { recursive: true });

	let totalIssues = 0;

	for (const result of results) {
		const { surface, snapshot, candidates, screenshotBuffer } = result;
		const profileKey = `${surface.id}:${surface.browser}:${surface.locale}`;
		const profileDir = join(artifactsDir, profileKey);
		await mkdir(profileDir, { recursive: true });

		// Save snapshot & screenshot locally
		await writeFile(join(profileDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
		await writeFile(join(profileDir, "full.png"), screenshotBuffer);

		// 2. Detect & score
		const scored = detectAndScore(candidates);
		const actionable = filterActionable(scored);
		console.log(
			`[scout] ${surface.name}: ${candidates.length} candidates, ${actionable.length} actionable`,
		);

		await writeFile(join(profileDir, "candidates.json"), JSON.stringify(scored, null, 2));

		if (actionable.length === 0) continue;

		// 3. Upload to Worker API (if configured)
		let screenshotUrl = `file://${join(profileDir, "full.png")}`;
		if (WORKER_URL) {
			screenshotUrl = await uploadScreenshot(
				screenshotBuffer,
				`${surface.id}/${surface.browser}/${surface.locale}/${runId}/full.png`,
			);

			// Push scan results
			await pushScanResults(result, scored, runId);

			// 4. Dedup check
			const fingerprints = actionable.map((c) => c.blockFingerprint);
			const dedupResults = await checkDedup(fingerprints);

			// Filter out duplicates
			const novel = actionable.filter((c) => !dedupResults[c.blockFingerprint]?.duplicate);
			if (novel.length === 0) {
				console.log(`[scout] ${surface.name}: all candidates are duplicates, skipping`);
				continue;
			}

			// 5. Create issues for novel findings
			if (GITHUB_TOKEN) {
				for (const candidate of novel) {
					const issue = composeIssue(candidate, surface, screenshotUrl);
					try {
						const created = await createGitHubIssue(
							issue,
							GITHUB_REPO_OWNER,
							GITHUB_REPO_NAME,
							GITHUB_TOKEN,
						);
						console.log(`[scout] Issue #${created.number}: ${created.url}`);
						totalIssues++;
					} catch (err) {
						console.error(`[scout] Failed to create issue:`, err);
					}
				}
			}
		} else {
			// No Worker URL — dry run, save issues as local JSON
			for (const candidate of actionable) {
				const issue = composeIssue(candidate, surface, screenshotUrl);
				const issueFile = join(profileDir, `issue-${candidate.blockFingerprint}.json`);
				await writeFile(issueFile, JSON.stringify(issue, null, 2));
				console.log(`[scout] [dry-run] Issue saved: ${issueFile}`);

				// Also save formatted body for review
				const bodyFile = join(profileDir, `issue-${candidate.blockFingerprint}.md`);
				await writeFile(bodyFile, `# ${issue.title}\n\n${formatIssueBody(issue)}`);
			}
		}
	}

	// Save run metadata
	await writeFile(
		join(artifactsDir, "run.json"),
		JSON.stringify({
			runId,
			timestamp: new Date().toISOString(),
			profiles: results.map((r) => `${r.surface.id}:${r.surface.browser}:${r.surface.locale}`),
			candidateCount: results.reduce((sum, r) => sum + r.candidates.length, 0),
			issuesCreated: totalIssues,
		}, null, 2),
	);

	console.log(`[scout] Scan complete. ${totalIssues} issue(s) created.`);
}

async function uploadScreenshot(buffer: Buffer, path: string): Promise<string> {
	const formData = new FormData();
	formData.append("file", new Blob([buffer], { type: "image/png" }), "screenshot.png");
	formData.append("path", path);

	const res = await fetch(`${WORKER_URL}/scan/screenshot`, {
		method: "POST",
		body: formData,
	});

	if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
	return `${WORKER_URL}/scan/screenshot/${path}`;
}

async function pushScanResults(
	result: CrawlResult,
	scored: ReturnType<typeof detectAndScore>,
	runId: string,
): Promise<void> {
	const payload = {
		runId,
		profileKey: `${result.surface.id}:${result.surface.browser}:${result.surface.locale}`,
		surface: result.surface.id,
		browser: result.surface.browser,
		locale: result.surface.locale,
		timestamp: new Date().toISOString(),
		candidates: scored.map((c) => ({
			blockFingerprint: c.blockFingerprint,
			layoutFingerprint: c.layoutFingerprint,
			score: c.totalScore,
			category: c.category,
			domSnippet: c.block.html.slice(0, 1500),
			signals: c.signals,
		})),
	};

	const res = await fetch(`${WORKER_URL}/scan/results`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!res.ok) throw new Error(`Push results failed: ${res.status}`);
}

async function checkDedup(
	fingerprints: string[],
): Promise<Record<string, { duplicate: boolean; reason?: string }>> {
	const res = await fetch(`${WORKER_URL}/dedup/check-batch`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ fingerprints }),
	});

	if (!res.ok) throw new Error(`Dedup check failed: ${res.status}`);
	return res.json();
}

main().catch((err) => {
	console.error("[scout] Fatal error:", err);
	process.exit(1);
});
