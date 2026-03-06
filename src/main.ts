/**
 * Debloat AI Scout — main entry point
 *
 * Executed by GHA cron or manually via `npm run scan`.
 * Crawls configured surfaces, detects AI insertions,
 * and pushes results to the CF Worker API.
 */

import { loadSurfaces } from "@configs/surfaces";

async function main() {
	const surfaces = loadSurfaces();
	console.log(`[scout] Starting scan for ${surfaces.length} surface(s)...`);

	// TODO Sprint 1: crawler → detect → fingerprint → score → dedup → issue
	for (const surface of surfaces) {
		console.log(`[scout] Surface: ${surface.name} (${surface.browser}/${surface.locale})`);
	}

	console.log("[scout] Scan complete.");
}

main().catch((err) => {
	console.error("[scout] Fatal error:", err);
	process.exit(1);
});
