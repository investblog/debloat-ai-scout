import type { Page } from "playwright";
import type { CandidateBlock } from "@/shared/types";

/**
 * Extract a reduced DOM snapshot from the page.
 * Strips scripts, styles, comments, and normalizes whitespace.
 */
export async function extractSnapshot(page: Page): Promise<string> {
	return page.evaluate(() => {
		const clone = document.documentElement.cloneNode(true) as HTMLElement;

		for (const sel of ["script", "style", "link[rel=stylesheet]", "noscript", "svg"]) {
			for (const el of clone.querySelectorAll(sel)) el.remove();
		}

		const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
		const comments: Comment[] = [];
		while (walker.nextNode()) comments.push(walker.currentNode as Comment);
		for (const c of comments) c.remove();

		for (const el of clone.querySelectorAll("[style]")) el.removeAttribute("style");
		for (const el of clone.querySelectorAll("[src^='data:']")) el.setAttribute("src", "[data-uri]");

		return clone.outerHTML.replace(/\s+/g, " ").trim();
	});
}

/**
 * Browser-side extraction script as a string literal.
 * This avoids tsx/esbuild __name() injection that breaks page.evaluate.
 */
const EXTRACT_CANDIDATES_SCRIPT = `
(args) => {
	var knownZones = args[0];
	var keywords = args[1];
	var candidates = [];
	var seen = new WeakSet();

	var getDepth = function(el) {
		var depth = 0;
		var current = el;
		while (current && current.parentElement) {
			depth++;
			current = current.parentElement;
		}
		return depth;
	};

	var cssPath = function(el) {
		var parts = [];
		var current = el;
		while (current && current !== document.body) {
			var selector = current.tagName.toLowerCase();
			if (current.id) {
				selector += '#' + current.id;
				parts.unshift(selector);
				break;
			}
			if (current.classList && current.classList.length > 0) {
				selector += '.' + Array.from(current.classList).join('.');
			}
			parts.unshift(selector);
			current = current.parentElement;
		}
		return parts.join(' > ');
	};

	var toCandidate = function(el, inShadowDom) {
		var rect = el.getBoundingClientRect();
		return {
			html: el.outerHTML.slice(0, 2000),
			selector: cssPath(el),
			textContent: (el.textContent || '').trim().slice(0, 500),
			tagName: el.tagName,
			classes: Array.from(el.classList),
			role: el.getAttribute('role'),
			ariaLabel: el.getAttribute('aria-label'),
			depth: getDepth(el),
			parentTag: el.parentElement ? el.parentElement.tagName : null,
			siblingCount: el.parentElement ? el.parentElement.children.length : 0,
			boundingBox: rect.width > 0
				? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
				: null,
			inShadowDom: inShadowDom
		};
	};

	var matchesKeyword = function(el) {
		var text = (el.textContent || '').toLowerCase();
		var label = (el.getAttribute('aria-label') || '').toLowerCase();
		var cn = (typeof el.className === 'string') ? el.className.toLowerCase() : '';
		var dataAttrs = '';
		for (var i = 0; i < el.attributes.length; i++) {
			var a = el.attributes[i];
			if (a.name.indexOf('data-') === 0) {
				dataAttrs += a.name + '=' + a.value + ' ';
			}
		}
		var combined = text + ' ' + label + ' ' + cn + ' ' + dataAttrs.toLowerCase();
		for (var k = 0; k < keywords.length; k++) {
			if (combined.indexOf(keywords[k].toLowerCase()) !== -1) return true;
		}
		return false;
	};

	for (var z = 0; z < knownZones.length; z++) {
		try {
			var zoneEls = document.querySelectorAll(knownZones[z]);
			for (var j = 0; j < zoneEls.length; j++) {
				var el = zoneEls[j];
				if (el instanceof HTMLElement && !seen.has(el)) {
					seen.add(el);
					candidates.push(toCandidate(el, false));
				}
			}
		} catch(e) {}
	}

	var allElements = document.querySelectorAll('div, section, aside, article, nav, main, [role]');
	for (var i = 0; i < allElements.length; i++) {
		var el = allElements[i];
		if (!(el instanceof HTMLElement) || seen.has(el)) continue;
		var rect = el.getBoundingClientRect();
		if (rect.width < 100 || rect.height < 50) continue;
		if (matchesKeyword(el)) {
			seen.add(el);
			candidates.push(toCandidate(el, false));
		}
	}

	var shadowHosts = document.querySelectorAll('*');
	for (var s = 0; s < shadowHosts.length; s++) {
		var host = shadowHosts[s];
		if (!host.shadowRoot) continue;
		var shadowEls = host.shadowRoot.querySelectorAll('div, section, aside, article');
		for (var t = 0; t < shadowEls.length; t++) {
			var el = shadowEls[t];
			if (!(el instanceof HTMLElement) || seen.has(el)) continue;
			if (matchesKeyword(el)) {
				seen.add(el);
				candidates.push(toCandidate(el, true));
			}
		}
	}

	return candidates;
}
`;

/**
 * Extract candidate blocks from the page.
 */
export async function extractCandidates(
	page: Page,
	knownZones: string[],
	keywords: readonly string[],
): Promise<CandidateBlock[]> {
	// Inject args as JSON and evaluate a raw string to avoid tsx __name() injection
	const argsJson = JSON.stringify([knownZones, [...keywords]]);
	const script = `(${EXTRACT_CANDIDATES_SCRIPT})(${argsJson})`;
	return page.evaluate(script);
}
