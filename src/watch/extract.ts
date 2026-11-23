/**
 * Pull Google-SERP selector signals out of an extension package.
 * Only content scripts (and their CSS) that run on Google are read; minified JS
 * is scanned with regexes for selector-shaped tokens, not parsed or run.
 */

export interface Signals {
	name: string;
	version: string;
	/** Sorted, de-duplicated tokens: #id, [attr op "value"], .class (CSS only), udm=N */
	tokens: string[];
}

interface Manifest {
	name?: string;
	version?: string;
	content_scripts?: { matches?: string[]; js?: string[]; css?: string[] }[];
	background?: { service_worker?: string; scripts?: string[] };
}

const GOOGLE_MATCH = /google\./i;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const ATTRS = "data-[\\w-]+|jsname|jscontroller|jsaction|jsmodel|aria-label|role|id|class";
const ATTR_RE = new RegExp(
	`\\[\\s*(${ATTRS})\\s*([~^$*|]?=)\\s*\\\\?["']?([^"'\\]\\\\]{1,60})\\\\?["']?\\s*\\]`,
	"g",
);
/** Not after ".", "/" or a word char: skips JS private fields (this.#x) and URL fragments */
const ID_RE = /(?<![./\w])#[A-Za-z][\w-]{2,40}/g;
/** udm=50, "udm")==="50", {key:"udm",value:"14"} */
const UDM_RE = /udm\W{1,6}(?:value\W{1,4})?(\d{1,3})\b/g;
/** JS string literals (single, double, template); escapes kept */
const STRING_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
/** Strip CSS comments and declaration blocks so only selectors remain */
const CSS_BLOCK_RE = /\/\*[\s\S]*?\*\/|\{[^{}]*\}/g;
const CLASS_RE = /\.[A-Za-z_][\w-]{2,40}/g;

export function extractSignals(files: Map<string, Buffer>): Signals {
	const manifestRaw = files.get("manifest.json");
	if (!manifestRaw) throw new Error("manifest.json missing");
	const manifest = JSON.parse(manifestRaw.toString("utf8").replace(/^﻿/, "")) as Manifest;

	const googleScripts = (manifest.content_scripts ?? []).filter((cs) =>
		(cs.matches ?? []).some((m) => GOOGLE_MATCH.test(m) || m === "<all_urls>" || m === "*://*/*"),
	);
	const jsFiles = new Set(googleScripts.flatMap((cs) => cs.js ?? []));
	const cssFiles = new Set(googleScripts.flatMap((cs) => cs.css ?? []));
	// dNR-based extensions (e.g. udm=14 redirects) keep their logic in the background
	for (const bg of [manifest.background?.service_worker, ...(manifest.background?.scripts ?? [])]) {
		if (bg) jsFiles.add(bg);
	}

	const tokens = new Set<string>();
	for (const name of jsFiles) {
		const text = files.get(name)?.toString("utf8");
		if (!text) continue;
		// Selectors live in string literals; scanning only those skips private fields (#x) and the like
		for (const m of text.matchAll(STRING_RE)) collectSelectors(m[0].slice(1, -1), tokens);
		for (const m of text.matchAll(UDM_RE)) tokens.add(`udm=${m[1]}`);
	}
	for (const name of cssFiles) {
		const text = files.get(name)?.toString("utf8");
		if (!text) continue;
		const selectors = text.replace(CSS_BLOCK_RE, " ");
		collectSelectors(selectors, tokens);
		for (const m of selectors.matchAll(CLASS_RE)) tokens.add(m[0]);
	}

	return {
		name: manifest.name ?? "",
		version: manifest.version ?? "",
		tokens: [...tokens].sort(),
	};
}

function collectSelectors(text: string, tokens: Set<string>): void {
	for (const m of text.matchAll(ATTR_RE)) tokens.add(`[${m[1]}${m[2]}"${m[3]}"]`);
	for (const m of text.matchAll(ID_RE)) if (!HEX_COLOR.test(m[0])) tokens.add(m[0]);
}
