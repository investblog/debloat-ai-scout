/**
 * Debloat AI Scout — main entry point
 *
 * Pipeline: crawl → detect → filter → score → baseline diff → dedup → issue
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AI_KEYWORDS } from "@configs/keywords";
import { loadSurfaces } from "@configs/surfaces";
import { crawlAll } from "@/crawler";
import { detectAndScore } from "@/detectors/heuristic";
import { applyFilters } from "@/detectors/filters";
import { filterActionable, getVerdict } from "@/scoring";
import { diffAgainstBaseline, buildBaseline } from "@/baseline/diff";
import { composeIssue, createGitHubIssue, formatIssueBody } from "@/github/issues";
import { WorkerClient } from "@/worker-client";

const WORKER_URL = process.env.WORKER_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "investblog";
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? "debloat";

async function main() {
	const surfaces = loadSurfaces(1);
	console.log(`[scout] Starting scan for ${surfaces.length} surface(s)...`);

	const worker = WORKER_URL ? new WorkerClient(WORKER_URL) : null;
	if (worker) console.log(`[scout] Worker API: ${WORKER_URL}`);
	else console.log("[scout] No WORKER_URL — running in local/dry-run mode");

	// 1. Crawl
	const { results, runId } = await crawlAll(surfaces, AI_KEYWORDS);
	console.log(`[scout] Crawl complete. Run ID: ${runId}`);

	const artifactsDir = join("artifacts", runId);
	await mkdir(artifactsDir, { recursive: true });

	let totalIssues = 0;

	for (const result of results) {
		const { surface, snapshot, candidates, screenshotBuffer } = result;
		const profileKey = `${surface.id}:${surface.browser}:${surface.locale}`;
		const profileDirName = `${surface.id}_${surface.browser}_${surface.locale}`;
		const profileDir = join(artifactsDir, profileDirName);
		await mkdir(profileDir, { recursive: true });

		// Save locally
		await writeFile(join(profileDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
		await writeFile(join(profileDir, "full.png"), screenshotBuffer);

		// 2. Detect → filter → score
		const scored = detectAndScore(candidates);
		const filtered = applyFilters(candidates, scored);
		const actionable = filterActionable(filtered);

		console.log(
			`[scout] ${surface.name}: ${candidates.length} raw, ${filtered.length} after filter, ${actionable.length} actionable`,
		);

		await writeFile(join(profileDir, "candidates.json"), JSON.stringify(scored, null, 2));

		// 3. Baseline diff
		let baseline = worker ? await worker.getBaseline(profileKey) : null;
		const diff = diffAgainstBaseline(actionable, baseline);

		if (diff.isFirstScan) {
			console.log(`[scout] ${surface.name}: first scan — establishing baseline`);
		} else {
			console.log(
				`[scout] ${surface.name}: diff — ${diff.added.length} new, ${diff.changed.length} changed, ${diff.removed.length} removed, ${diff.unchanged.length} unchanged`,
			);
		}

		await writeFile(join(profileDir, "diff.json"), JSON.stringify({
			isFirstScan: diff.isFirstScan,
			added: diff.added.length,
			changed: diff.changed.length,
			removed: diff.removed.length,
			unchanged: diff.unchanged.length,
		}, null, 2));

		// Only new and changed candidates create issues
		const issueWorthy = [...diff.added, ...diff.changed.map((c) => c.current)];

		if (issueWorthy.length === 0 && !diff.isFirstScan) {
			console.log(`[scout] ${surface.name}: no new findings`);
			continue;
		}

		// 4. Upload artifacts to R2
		let screenshotUrl = `file://${join(profileDir, "full.png")}`;
		if (worker) {
			const r2Path = `${surface.id}/${surface.browser}/${surface.locale}/${runId}/full.png`;
			screenshotUrl = await worker.uploadScreenshot(screenshotBuffer, r2Path);

			await worker.pushScanResults({
				runId,
				profileKey,
				surface: surface.id,
				browser: surface.browser,
				locale: surface.locale,
				timestamp: new Date().toISOString(),
				candidates: actionable.map((c) => ({
					blockFingerprint: c.blockFingerprint,
					layoutFingerprint: c.layoutFingerprint,
					score: c.totalScore,
					category: c.category,
					domSnippet: c.block.html.slice(0, 1500),
					signals: c.signals,
				})),
			});
		}

		// 5. Dedup check
		if (worker && issueWorthy.length > 0) {
			const fingerprints = issueWorthy.map((c) => c.blockFingerprint);
			const dedupResults = await worker.checkDedup(fingerprints);
			const novel = issueWorthy.filter((c) => !dedupResults[c.blockFingerprint]?.duplicate);

			if (novel.length === 0) {
				console.log(`[scout] ${surface.name}: all findings are duplicates`);
			} else {
				// 6. Create GitHub issues
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
				} else {
					console.log(`[scout] ${surface.name}: ${novel.length} novel finding(s), but no GITHUB_TOKEN`);
				}
			}
		} else if (!worker) {
			// Dry-run mode: save issues as local files
			for (const candidate of issueWorthy) {
				const issue = composeIssue(candidate, surface, screenshotUrl);
				const issueFile = join(profileDir, `issue-${candidate.blockFingerprint}.json`);
				await writeFile(issueFile, JSON.stringify(issue, null, 2));
				const bodyFile = join(profileDir, `issue-${candidate.blockFingerprint}.md`);
				await writeFile(bodyFile, `# ${issue.title}\n\n${formatIssueBody(issue)}`);
				console.log(`[scout] [dry-run] Issue: ${issue.title} (score=${candidate.totalScore})`);
			}
		}

		// 7. Update baseline
		if (diff.isFirstScan || diff.added.length > 0 || diff.changed.length > 0) {
			const newBaseline = buildBaseline(profileKey, actionable, snapshot, runId);
			if (worker) {
				if (diff.isFirstScan) {
					// First scan — set as stable immediately
					await worker.putBaseline(profileKey, newBaseline);
					console.log(`[scout] ${surface.name}: stable baseline created`);
				} else {
					// Subsequent scans with changes — store as candidate
					await worker.putCandidateBaseline(profileKey, newBaseline);
					console.log(`[scout] ${surface.name}: candidate baseline stored (pending review)`);
				}
			}
			await writeFile(join(profileDir, "baseline.json"), JSON.stringify(newBaseline, null, 2));
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
			mode: worker ? "live" : "dry-run",
		}, null, 2),
	);

	console.log(`[scout] Scan complete. ${totalIssues} issue(s) created.`);
}

main().catch((err) => {
	console.error("[scout] Fatal error:", err);
	process.exit(1);
});
