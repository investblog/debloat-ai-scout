import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZip } from "./crx";
import { coveredBy, diffSnapshot, formatIssue, type Snapshot } from "./diff";
import { extractSignals } from "./extract";

/** Minimal ZIP writer (deflate) for tests, optionally behind a fake CRX header */
function makeZip(entries: Record<string, string>, crxHeader = false): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(entries)) {
		const data = deflateRawSync(Buffer.from(text));
		const nameBuf = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, data);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const cd = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(Object.keys(entries).length, 10);
	eocd.writeUInt32LE(cd.length, 12);
	eocd.writeUInt32LE(offset, 16);
	const zip = Buffer.concat([...locals, cd, eocd]);
	return crxHeader
		? Buffer.concat([Buffer.from("Cr24\x03\x00\x00\x00\x04\x00\x00\x00abcd"), zip])
		: zip;
}

const MANIFEST = JSON.stringify({
	name: "Competitor",
	version: "1.2.3",
	content_scripts: [
		{ matches: ["*://www.google.com/search*"], js: ["content.js"], css: ["app.css"] },
		{ matches: ["*://example.com/*"], js: ["other.js"] },
	],
	background: { service_worker: "bg.js" },
});

const CONTENT = `const S={AIO:"#Odp5De",T:'[data-subtree="mfc"]',P:"[data-initq], div.related-question-pair",
	C:"color:#fff;background:#0D6AFB"};class X{#secret=1;go(){location.href="https://x.com/#anchor";
	return new URL(a).searchParams.get("udm")==="50"}}`;
const CSS = `/* .commented */ body[data-ai="1"] .RDmXvc.Jzkafd > div { display: none; color: #abc }
	[jscontroller="g5dM4c"] .b0Zsmc { height: 0 }`;
const BG = `rules=[{action:{redirect:{transform:{queryTransform:{addOrReplaceParams:[{key:"udm",value:"14"}]}}}}}]`;

describe("readZip", () => {
	it("reads deflated entries, also behind a CRX header", () => {
		for (const crx of [false, true]) {
			const files = readZip(makeZip({ "a.txt": "hello", "dir/b.js": "world" }, crx));
			expect(files.get("a.txt")?.toString()).toBe("hello");
			expect(files.get("dir/b.js")?.toString()).toBe("world");
		}
	});
});

describe("extractSignals", () => {
	const files = readZip(
		makeZip({
			"manifest.json": MANIFEST,
			"content.js": CONTENT,
			"app.css": CSS,
			"bg.js": BG,
			"other.js": "#notGoogle",
		}),
	);
	const s = extractSignals(files);

	it("takes name/version from the manifest", () => {
		expect(s).toMatchObject({ name: "Competitor", version: "1.2.3" });
	});

	it("extracts ids, attribute selectors, CSS classes and udm values from Google scripts", () => {
		expect(s.tokens).toEqual(
			expect.arrayContaining([
				"#Odp5De",
				'[data-subtree="mfc"]',
				'[jscontroller="g5dM4c"]',
				'[data-ai="1"]',
				".RDmXvc",
				".Jzkafd",
				".b0Zsmc",
				"udm=50",
				"udm=14",
			]),
		);
	});

	it("skips hex colors, private fields, URL fragments, CSS comments and non-Google scripts", () => {
		for (const t of ["#fff", "#0D6AFB", "#abc", "#secret", "#anchor", ".commented", "#notGoogle"]) {
			expect(s.tokens).not.toContain(t);
		}
	});
});

describe("diffSnapshot / formatIssue", () => {
	const snap = (version: string, tokens: string[]): Snapshot => ({
		id: "abc",
		name: "Comp",
		version,
		tokens,
		fetchedAt: "",
	});

	it("treats the first snapshot as a baseline", () => {
		expect(diffSnapshot(null, snap("1", ["#a"]))).toBeNull();
	});

	it("reports added and removed tokens, ignores pure version bumps", () => {
		expect(diffSnapshot(snap("1", ["#a"]), snap("2", ["#a"]))).toBeNull();
		expect(diffSnapshot(snap("1", ["#a", "#b"]), snap("2", ["#a", "#c"]))).toMatchObject({
			added: ["#c"],
			removed: ["#b"],
			fromVersion: "1",
			toVersion: "2",
		});
	});

	it("marks tokens Debloat already has", () => {
		const ours = `export const X = ['#Odp5De', 'div[data-subtree="mfc"]'];`;
		expect(coveredBy(ours, "#Odp5De")).toBe(true);
		expect(coveredBy(ours, '[data-subtree="mfc"]')).toBe(true);
		expect(coveredBy(ours, "#NewOne")).toBe(false);
		const { body } = formatIssue(
			[
				{
					id: "abc",
					name: "Comp",
					fromVersion: "1",
					toVersion: "2",
					added: ["#Odp5De", "#NewOne"],
					removed: [],
				},
			],
			ours,
		);
		expect(body).toContain("`#Odp5De` — ✅ already in Debloat");
		expect(body).toContain("`#NewOne` — 🆕");
	});
});
