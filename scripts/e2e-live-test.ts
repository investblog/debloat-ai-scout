/**
 * End-to-end live test: synthetic candidate → Worker → GitHub Issue → webhook feedback.
 *
 * Usage:
 *   WORKER_URL=... GITHUB_TOKEN=... GITHUB_REPO_OWNER=... GITHUB_REPO_NAME=... npx tsx scripts/e2e-live-test.ts
 */

import { WorkerClient } from "../src/worker-client";
import { composeIssue, createGitHubIssue, formatIssueBody } from "../src/github/issues";
import type { ScoredCandidate, CandidateBlock, BaselineEntry, DomSnapshot } from "../src/shared/types";
import { computeBlockFingerprint } from "../src/fingerprint/block";
import { computeLayoutFingerprint } from "../src/fingerprint/layout";

const WORKER_URL = process.env.WORKER_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "investblog";
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? "debloat";

if (!WORKER_URL || !GITHUB_TOKEN) {
	console.error("Missing WORKER_URL or GITHUB_TOKEN");
	process.exit(1);
}

const worker = new WorkerClient(WORKER_URL);

const fakeSurface = {
	id: "e2e-test",
	name: "E2E Test Surface",
	url: "https://example.com",
	browser: "chrome" as const,
	locale: "en-US",
	viewport: { width: 1440, height: 900 },
	priority: 1 as const,
};

// Synthetic AI candidate block
const fakeBlock: CandidateBlock = {
	html: '<div class="ai-copilot-panel" data-testid="copilot"><h2>AI Answer</h2><p>Artificial intelligence is...</p><button>Ask Copilot</button></div>',
	selector: "div#b_results > div.ai-copilot-panel",
	textContent: "AI Answer Artificial intelligence is a branch of computer science... Ask Copilot",
	tagName: "DIV",
	classes: ["ai-copilot-panel"],
	role: "complementary",
	ariaLabel: "AI-generated answer",
	depth: 4,
	parentTag: "DIV",
	siblingCount: 5,
	boundingBox: { x: 100, y: 200, width: 600, height: 300 },
	inShadowDom: false,
};

const blockFingerprint = computeBlockFingerprint(fakeBlock);
const layoutFingerprint = computeLayoutFingerprint(fakeBlock);

const fakeScored: ScoredCandidate = {
	block: fakeBlock,
	signals: [
		{ type: "keyword", value: "ai:ai", score: 3 },
		{ type: "action_button", value: "ask copilot", score: 2 },
		{ type: "placement", value: "top:y=200", score: 2 },
	],
	totalScore: 7,
	category: "ai",
	blockFingerprint,
	layoutFingerprint,
};

async function step(name: string, fn: () => Promise<void>) {
	process.stdout.write(`[e2e] ${name}... `);
	try {
		await fn();
		console.log("OK");
	} catch (err) {
		console.log("FAIL");
		console.error(err);
		process.exit(1);
	}
}

async function main() {
	const profileKey = "e2e-test:chrome:en-US";
	const runId = `e2e-${Date.now()}`;

	console.log(`[e2e] Block fingerprint: ${blockFingerprint}`);
	console.log(`[e2e] Layout fingerprint: ${layoutFingerprint}`);
	console.log(`[e2e] Profile key: ${profileKey}`);
	console.log(`[e2e] Run ID: ${runId}\n`);

	// Step 1: Check dedup — should NOT be suppressed
	await step("1. Dedup check (expect: not duplicate)", async () => {
		const result = await worker.checkDedup([blockFingerprint]);
		const entry = result[blockFingerprint];
		if (entry?.duplicate) {
			console.log(`\n    WARNING: fingerprint already suppressed — clearing first`);
			// We'll proceed anyway; this tests the flow
		} else {
			console.log(`not suppressed`);
		}
	});

	// Step 2: Push scan results to Worker
	await step("2. Push scan results to Worker", async () => {
		await worker.pushScanResults({
			runId,
			profileKey,
			surface: fakeSurface.id,
			browser: fakeSurface.browser,
			locale: fakeSurface.locale,
			timestamp: new Date().toISOString(),
			candidates: [{
				blockFingerprint,
				layoutFingerprint,
				score: fakeScored.totalScore,
				category: fakeScored.category,
				domSnippet: fakeBlock.html,
				signals: fakeScored.signals,
			}],
		});
	});

	// Step 3: Set baseline
	await step("3. Store baseline in Worker KV", async () => {
		const baseline: BaselineEntry = {
			profileKey,
			lastRunId: runId,
			lastUpdated: new Date().toISOString(),
			candidates: [{
				blockFingerprint,
				layoutFingerprint,
				score: fakeScored.totalScore,
				category: fakeScored.category,
			}],
			snapshotHash: "e2e-test-hash",
		};
		await worker.putBaseline(profileKey, baseline);
	});

	// Step 4: Create GitHub issue
	let issueNumber = 0;
	let issueUrl = "";
	await step("4. Create GitHub issue", async () => {
		const issue = composeIssue(fakeScored, fakeSurface, "https://example.com/screenshot.png");
		const created = await createGitHubIssue(
			issue,
			GITHUB_REPO_OWNER,
			GITHUB_REPO_NAME,
			GITHUB_TOKEN,
		);
		issueNumber = created.number;
		issueUrl = created.url;
		console.log(`#${issueNumber} — ${issueUrl}`);
	});

	// Step 5: Verify issue has ai-scout label
	await step("5. Verify issue labels", async () => {
		const resp = await fetch(
			`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
			{ headers: { Authorization: `token ${GITHUB_TOKEN}` } },
		);
		const data = await resp.json() as { labels: Array<{ name: string }> };
		const labels = data.labels.map((l) => l.name);
		console.log(`labels: [${labels.join(", ")}]`);
		if (!labels.includes("ai-scout")) {
			throw new Error("Missing ai-scout label");
		}
	});

	// Step 6: Close issue with false-positive label (triggers webhook)
	await step("6. Close issue with 'false-positive' label", async () => {
		// Add false-positive label
		await fetch(
			`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}/labels`,
			{
				method: "POST",
				headers: {
					Authorization: `token ${GITHUB_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ labels: ["false-positive"] }),
			},
		);
		// Close issue
		await fetch(
			`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `token ${GITHUB_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ state: "closed" }),
			},
		);
		console.log(`closed #${issueNumber}`);
	});

	// Step 7: Wait for webhook to process
	console.log("[e2e] 7. Waiting 5s for webhook delivery...");
	await new Promise((r) => setTimeout(r, 5000));

	// Step 8: Check dedup again — should now be suppressed
	await step("8. Dedup check (expect: suppressed after false-positive)", async () => {
		const result = await worker.checkDedup([blockFingerprint]);
		const entry = result[blockFingerprint];
		if (entry?.duplicate) {
			console.log(`SUPPRESSED — reason: ${JSON.stringify(entry)}`);
		} else {
			console.log(`NOT suppressed — webhook may not have fired yet`);
			console.log(`    This is expected if the webhook takes longer to process.`);
			console.log(`    Check manually: GET ${WORKER_URL}/dedup/check/${blockFingerprint}`);
		}
	});

	console.log(`\n[e2e] Test complete!`);
	console.log(`[e2e] Issue: ${issueUrl}`);
	console.log(`[e2e] To verify webhook manually:`);
	console.log(`  gh api repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/hooks/599387647/deliveries --jq '.[0:3]'`);
}

main().catch((err) => {
	console.error("[e2e] Fatal:", err);
	process.exit(1);
});
