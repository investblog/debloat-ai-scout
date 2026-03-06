import type { BrowserTarget } from "@/shared/types";

export interface SurfaceConfig {
	/** Unique surface identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** URL to crawl */
	url: string;
	/** Search query (for search surfaces) */
	query?: string;
	/** Target browser */
	browser: BrowserTarget;
	/** Locale */
	locale: string;
	/** Viewport size */
	viewport: { width: number; height: number };
	/** Priority (P1 = highest) */
	priority: 1 | 2 | 3;
	/** CSS selectors for known AI zones to check */
	knownZones?: string[];
	/** Requires specific browser engine (can't run in generic Chromium) */
	requiresBrowser?: boolean;
}

/** P1 surfaces for MVP */
const P1_SURFACES: SurfaceConfig[] = [
	{
		id: "google-search",
		name: "Google Search",
		url: "https://www.google.com/search",
		query: "what is artificial intelligence",
		browser: "chrome",
		locale: "en-US",
		viewport: { width: 1440, height: 900 },
		priority: 1,
		knownZones: ["#rso .ai-overview", "#botstuff", ".kp-wholepage"],
	},
	{
		id: "bing-search",
		name: "Bing Search",
		url: "https://www.bing.com/search",
		query: "what is artificial intelligence",
		browser: "edge",
		locale: "en-US",
		viewport: { width: 1440, height: 900 },
		priority: 1,
		knownZones: ["#b_results .b_ans", ".bnc_container", "#copans_container"],
	},
	{
		id: "edge-ntp",
		name: "Edge New Tab",
		url: "edge://newtab",
		browser: "edge",
		locale: "en-US",
		viewport: { width: 1440, height: 900 },
		priority: 1,
		knownZones: [],
		requiresBrowser: true,
	},
	{
		id: "firefox-home",
		name: "Firefox Home",
		url: "about:home",
		browser: "firefox",
		locale: "en-US",
		viewport: { width: 1440, height: 900 },
		priority: 1,
		knownZones: [],
		requiresBrowser: true,
	},
];

export function loadSurfaces(priority?: 1 | 2 | 3): SurfaceConfig[] {
	const all = [...P1_SURFACES];
	if (priority !== undefined) {
		return all.filter((s) => s.priority === priority);
	}
	return all;
}
