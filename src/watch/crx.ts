/**
 * Download a Chrome Web Store package and read it in memory.
 * A CRX3 file is a header followed by a plain ZIP; nothing is written to disk
 * and nothing from the package is executed.
 */
import { inflateRawSync } from "node:zlib";

const UPDATE_URL = "https://clients2.google.com/service/update2/crx";

export function crxUrl(id: string, prodversion = "142.0"): string {
	const x = encodeURIComponent(`id=${id}&uc`);
	return `${UPDATE_URL}?response=redirect&prodversion=${prodversion}&acceptformat=crx2,crx3&x=${x}`;
}

export async function downloadCrx(id: string): Promise<Buffer> {
	const res = await fetch(crxUrl(id), { redirect: "follow" });
	if (!res.ok) throw new Error(`CRX ${id}: HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

/** Read every file of a ZIP (or a CRX, whose ZIP starts after a header) into memory */
export function readZip(buf: Buffer): Map<string, Buffer> {
	const EOCD = 0x06054b50;
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
		if (buf.readUInt32LE(i) === EOCD) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("not a zip: end of central directory not found");

	const count = buf.readUInt16LE(eocd + 10);
	const cdSize = buf.readUInt32LE(eocd + 12);
	const cdOffset = buf.readUInt32LE(eocd + 16);
	// Offsets are relative to the ZIP start, which follows the CRX header
	const zipStart = eocd - cdSize - cdOffset;

	const files = new Map<string, Buffer>();
	let p = zipStart + cdOffset;
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
		const method = buf.readUInt16LE(p + 10);
		const compSize = buf.readUInt32LE(p + 20);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const localOffset = buf.readUInt32LE(p + 42);
		const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
		p += 46 + nameLen + extraLen + commentLen;
		if (name.endsWith("/")) continue;

		const local = zipStart + localOffset;
		if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header: ${name}`);
		const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const data = buf.subarray(dataStart, dataStart + compSize);
		if (method === 0) files.set(name, Buffer.from(data));
		else if (method === 8) files.set(name, inflateRawSync(data));
		// other methods are not used by the Web Store packager; skip
	}
	return files;
}
