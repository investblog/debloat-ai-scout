import type { Signals } from "./extract";

export interface Snapshot extends Signals {
	id: string;
	fetchedAt: string;
}

export interface Change {
	id: string;
	name: string;
	fromVersion: string | null;
	toVersion: string;
	added: string[];
	removed: string[];
}

/** null when nothing worth reporting changed (first snapshot = baseline, not a change) */
export function diffSnapshot(prev: Snapshot | null, next: Snapshot): Change | null {
	if (!prev) return null;
	const before = new Set(prev.tokens);
	const after = new Set(next.tokens);
	const added = next.tokens.filter((t) => !before.has(t));
	const removed = prev.tokens.filter((t) => !after.has(t));
	if (added.length === 0 && removed.length === 0) return null;
	return {
		id: next.id,
		name: next.name,
		fromVersion: prev.version,
		toVersion: next.version,
		added,
		removed,
	};
}

/** Is a competitor token already present in our selectors source? (plain substring check on the core value) */
export function coveredBy(ourSource: string, token: string): boolean {
	const core = token.startsWith("[") ? token.replace(/^\[([\w-]+)[~^$*|]?="(.*)"\]$/, "$2") : token;
	return ourSource.includes(core);
}

export function formatIssue(
	changes: Change[],
	ourSource: string | null,
): { title: string; body: string } {
	const date = new Date().toISOString().slice(0, 10);
	const lines = [
		"Competitors changed the Google SERP selectors they ship. New tokens are leads, not facts —",
		"verify on a live SERP before adding them to `src/selectors/google-search.ts`.",
		"",
	];
	for (const c of changes) {
		const url = `https://chromewebstore.google.com/detail/${c.id}`;
		lines.push(`### [${c.name}](${url}) ${c.fromVersion ?? "?"} → ${c.toVersion}`, "");
		if (c.added.length) {
			lines.push("**Added**", "");
			for (const t of c.added) {
				const mark =
					ourSource == null ? "" : coveredBy(ourSource, t) ? " — ✅ already in Debloat" : " — 🆕";
				lines.push(`- \`${t}\`${mark}`);
			}
			lines.push("");
		}
		if (c.removed.length) {
			lines.push("**Removed** (may mean Google dropped it)", "");
			for (const t of c.removed) lines.push(`- \`${t}\``);
			lines.push("");
		}
	}
	return { title: `Competitor selector changes — ${date}`, body: lines.join("\n") };
}
