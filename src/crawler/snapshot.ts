import type { Page } from "playwright";
import type { CandidateBlock } from "@/shared/types";

/**
 * Extract a reduced DOM snapshot from the page.
 * Strips scripts, styles, comments, and normalizes whitespace.
 */
export async function extractSnapshot(page: Page): Promise<string> {
	return page.evaluate(() => {
		const clone = document.documentElement.cloneNode(true) as HTMLElement;

		// Remove noise elements
		for (const sel of ["script", "style", "link[rel=stylesheet]", "noscript", "svg"]) {
			for (const el of clone.querySelectorAll(sel)) {
				el.remove();
			}
		}

		// Remove comments
		const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
		const comments: Comment[] = [];
		while (walker.nextNode()) comments.push(walker.currentNode as Comment);
		for (const c of comments) c.remove();

		// Remove data URIs and inline styles to reduce size
		for (const el of clone.querySelectorAll("[style]")) {
			el.removeAttribute("style");
		}
		for (const el of clone.querySelectorAll("[src^='data:']")) {
			el.setAttribute("src", "[data-uri]");
		}

		return clone.outerHTML.replace(/\s+/g, " ").trim();
	});
}

/**
 * Extract candidate blocks from the page.
 * Looks for elements matching AI-related heuristic signals.
 */
export async function extractCandidates(
	page: Page,
	knownZones: string[],
	keywords: readonly string[],
): Promise<CandidateBlock[]> {
	return page.evaluate(
		({ knownZones, keywords }) => {
			const candidates: CandidateBlock[] = [];
			const seen = new WeakSet<Element>();

			function getDepth(el: Element): number {
				let depth = 0;
				let current: Element | null = el;
				while (current?.parentElement) {
					depth++;
					current = current.parentElement;
				}
				return depth;
			}

			function toCandidate(el: HTMLElement, inShadowDom: boolean): CandidateBlock {
				const rect = el.getBoundingClientRect();
				return {
					html: el.outerHTML.slice(0, 2000),
					selector: cssPath(el),
					textContent: (el.textContent ?? "").trim().slice(0, 500),
					tagName: el.tagName,
					classes: Array.from(el.classList),
					role: el.getAttribute("role"),
					ariaLabel: el.getAttribute("aria-label"),
					depth: getDepth(el),
					parentTag: el.parentElement?.tagName ?? null,
					siblingCount: el.parentElement?.children.length ?? 0,
					boundingBox:
						rect.width > 0
							? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
							: null,
					inShadowDom,
				};
			}

			function cssPath(el: Element): string {
				const parts: string[] = [];
				let current: Element | null = el;
				while (current && current !== document.body) {
					let selector = current.tagName.toLowerCase();
					if (current.id) {
						selector += `#${current.id}`;
						parts.unshift(selector);
						break;
					}
					if (current.classList.length > 0) {
						selector += `.${Array.from(current.classList).join(".")}`;
					}
					parts.unshift(selector);
					current = current.parentElement;
				}
				return parts.join(" > ");
			}

			function matchesKeyword(el: HTMLElement): boolean {
				const text = (el.textContent ?? "").toLowerCase();
				const label = (el.getAttribute("aria-label") ?? "").toLowerCase();
				const classes = el.className.toLowerCase();
				const dataAttrs = Array.from(el.attributes)
					.filter((a) => a.name.startsWith("data-"))
					.map((a) => `${a.name}=${a.value}`.toLowerCase())
					.join(" ");
				const combined = `${text} ${label} ${classes} ${dataAttrs}`;

				return keywords.some((kw) => combined.includes(kw.toLowerCase()));
			}

			// 1. Check known zones first
			for (const selector of knownZones) {
				for (const el of document.querySelectorAll(selector)) {
					if (el instanceof HTMLElement && !seen.has(el)) {
						seen.add(el);
						candidates.push(toCandidate(el, false));
					}
				}
			}

			// 2. Scan all substantial elements for keyword matches
			const allElements = document.querySelectorAll(
				"div, section, aside, article, nav, main, [role]",
			);
			for (const el of allElements) {
				if (!(el instanceof HTMLElement) || seen.has(el)) continue;
				// Skip tiny elements
				const rect = el.getBoundingClientRect();
				if (rect.width < 100 || rect.height < 50) continue;
				// Skip deeply nested (likely child of already-found candidate)
				if (candidates.some((c) => el.closest(c.selector))) continue;

				if (matchesKeyword(el)) {
					seen.add(el);
					candidates.push(toCandidate(el, false));
				}
			}

			// 3. Check shadow DOM roots
			const shadowHosts = document.querySelectorAll("*");
			for (const host of shadowHosts) {
				if (!host.shadowRoot) continue;
				const shadowEls = host.shadowRoot.querySelectorAll(
					"div, section, aside, article",
				);
				for (const el of shadowEls) {
					if (!(el instanceof HTMLElement) || seen.has(el)) continue;
					if (matchesKeyword(el)) {
						seen.add(el);
						candidates.push(toCandidate(el, true));
					}
				}
			}

			return candidates;
		},
		{ knownZones, keywords: keywords as unknown as string[] },
	);
}
