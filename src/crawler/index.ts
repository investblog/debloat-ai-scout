import { chromium, type Browser, type BrowserContext } from "playwright";
import type { SurfaceConfig } from "@configs/surfaces";
import type { CandidateBlock, DomSnapshot, RunMetadata } from "@/shared/types";
import { extractCandidates, extractSnapshot } from "./snapshot";

export interface CrawlResult {
	surface: SurfaceConfig;
	snapshot: DomSnapshot;
	candidates: CandidateBlock[];
	screenshotBuffer: Buffer;
}

/**
 * Crawl a single surface and extract DOM snapshot + candidates.
 */
export async function crawlSurface(
	context: BrowserContext,
	surface: SurfaceConfig,
	keywords: readonly string[],
): Promise<CrawlResult> {
	const page = await context.newPage();

	try {
		// Build URL with query if search surface
		let url = surface.url;
		if (surface.query) {
			const u = new URL(url);
			u.searchParams.set("q", surface.query);
			url = u.toString();
		}

		console.log(`  [crawl] Navigating to ${url}`);
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

		// Extra wait for dynamic content to render
		await page.waitForTimeout(5000);

		console.log(`  [crawl] Extracting snapshot...`);
		const reducedHtml = await extractSnapshot(page);

		console.log(`  [crawl] Extracting candidates...`);
		const candidates = await extractCandidates(
			page,
			surface.knownZones ?? [],
			keywords,
		);
		console.log(`  [crawl] Found ${candidates.length} candidate(s)`);

		const screenshotBuffer = await page.screenshot({ fullPage: true });

		const snapshot: DomSnapshot = {
			url,
			title: await page.title(),
			timestamp: new Date().toISOString(),
			reducedHtml,
			candidates,
		};

		return { surface, snapshot, candidates, screenshotBuffer: Buffer.from(screenshotBuffer) };
	} finally {
		await page.close();
	}
}

/**
 * Launch browser and crawl all given surfaces.
 */
export async function crawlAll(
	surfaces: SurfaceConfig[],
	keywords: readonly string[],
): Promise<{ results: CrawlResult[]; runId: string }> {
	const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const results: CrawlResult[] = [];

	let browser: Browser | null = null;
	try {
		browser = await chromium.launch({
			headless: true,
		});

		for (const surface of surfaces) {
			if (surface.requiresBrowser) {
				console.log(`[scout] Skipping ${surface.name} (requires native ${surface.browser} browser)`);
				continue;
			}

			console.log(`[scout] Crawling: ${surface.name} (${surface.browser}/${surface.locale})`);

			const context = await browser.newContext({
				viewport: surface.viewport,
				locale: surface.locale,
				userAgent: getUserAgent(surface.browser),
			});

			try {
				const result = await crawlSurface(context, surface, keywords);
				results.push(result);
			} catch (err) {
				console.error(`[scout] Failed to crawl ${surface.name}:`, err);
			} finally {
				await context.close();
			}
		}
	} finally {
		await browser?.close();
	}

	return { results, runId };
}

function getUserAgent(browser: string): string {
	switch (browser) {
		case "edge":
			return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
		case "firefox":
			return "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0";
		default:
			return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	}
}
