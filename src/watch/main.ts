/**
 * Competitor watch: fetch each watched extension, extract its Google selector
 * tokens, compare with the committed snapshot, report changes as one issue.
 *
 * Env: GITHUB_TOKEN + GITHUB_REPOSITORY (owner/repo) to open the issue; without
 * them the report is printed only. Snapshots are rewritten in ./snapshots and
 * committed by the workflow.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { COMPETITORS, OUR_SELECTORS_URL } from "@configs/competitors";
import { downloadCrx, readZip } from "./crx";
import { type Change, diffSnapshot, formatIssue, type Snapshot } from "./diff";
import { extractSignals } from "./extract";

const SNAPSHOT_DIR = "snapshots";

async function readSnapshot(id: string): Promise<Snapshot | null> {
	try {
		return JSON.parse(await readFile(join(SNAPSHOT_DIR, `${id}.json`), "utf8")) as Snapshot;
	} catch {
		return null;
	}
}

async function fetchText(url: string): Promise<string | null> {
	try {
		const res = await fetch(url);
		return res.ok ? await res.text() : null;
	} catch {
		return null;
	}
}

async function openIssue(title: string, body: string): Promise<void> {
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.GITHUB_REPOSITORY;
	if (!token || !repo) {
		console.log("[watch] no GITHUB_TOKEN/GITHUB_REPOSITORY — issue not created");
		return;
	}
	const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ title, body, labels: ["competitor-signal"] }),
	});
	if (!res.ok) throw new Error(`issue: HTTP ${res.status} ${await res.text()}`);
	console.log(`[watch] issue created: ${((await res.json()) as { html_url: string }).html_url}`);
}

async function main(): Promise<void> {
	await mkdir(SNAPSHOT_DIR, { recursive: true });
	const changes: Change[] = [];
	let failures = 0;

	for (const c of COMPETITORS) {
		try {
			const signals = extractSignals(readZip(await downloadCrx(c.id)));
			const next: Snapshot = {
				id: c.id,
				fetchedAt: new Date().toISOString(),
				...signals,
				name: c.name,
			};
			const prev = await readSnapshot(c.id);
			const change = diffSnapshot(prev, next);
			console.log(
				`[watch] ${c.name} ${next.version}: ${next.tokens.length} tokens` +
					(prev
						? change
							? ` (+${change.added.length} −${change.removed.length})`
							: " (no change)"
						: " (baseline)"),
			);
			if (change) changes.push(change);
			// Rewrite only on first run or real change, so unchanged weeks leave git clean
			if (!prev || change || prev.version !== next.version) {
				await writeFile(
					join(SNAPSHOT_DIR, `${c.id}.json`),
					`${JSON.stringify(next, null, "\t")}\n`,
				);
			}
		} catch (err) {
			failures++;
			console.error(`[watch] ${c.name}: ${(err as Error).message}`);
		}
	}

	if (changes.length > 0) {
		const { title, body } = formatIssue(changes, await fetchText(OUR_SELECTORS_URL));
		console.log(`\n${title}\n\n${body}`);
		await openIssue(title, body);
	}
	if (failures === COMPETITORS.length) throw new Error("every download failed");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
