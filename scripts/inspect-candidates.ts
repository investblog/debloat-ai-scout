import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const artifactsDir = readdirSync("artifacts").sort().pop();
if (!artifactsDir) { console.log("No artifacts"); process.exit(1); }

const runDir = join("artifacts", artifactsDir);
const profiles = readdirSync(runDir).filter(f => !f.endsWith(".json"));

const filterArg = process.argv[2]; // optional: "google" or "bing"

for (const profile of profiles) {
	if (filterArg && !profile.includes(filterArg)) continue;
	const candidatesFile = join(runDir, profile, "candidates.json");
	try {
		const data = JSON.parse(readFileSync(candidatesFile, "utf8"));
		console.log(`\n=== ${profile} (${data.length} candidates) ===\n`);
		for (const c of data) {
			const text = c.block.textContent.slice(0, 80).replace(/\s+/g, " ");
			const signals = c.signals.map((s: any) => `${s.type}:${s.value}`).join(", ");
			console.log(`  [${c.totalScore}] ${c.block.tagName} ${c.block.selector.slice(0, 80)}`);
			console.log(`      text: "${text}"`);
			console.log(`      signals: ${signals || "(none)"}`);
			console.log();
		}
	} catch {}
}
