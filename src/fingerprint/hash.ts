/**
 * Portable hash function — works in Node.js, CF Workers, and browser.
 * Uses FNV-1a (64-bit) for fast, stable fingerprinting.
 * Crypto-strength not needed — this is for dedup, not security.
 */

/* FNV-1a offset basis and prime for 64-bit (using BigInt) */
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a hash, returned as 16-char hex string */
export function hashString(input: string): string {
	let hash = FNV_OFFSET;
	for (let i = 0; i < input.length; i++) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = (hash * FNV_PRIME) & MASK_64;
	}
	return hash.toString(16).padStart(16, "0");
}
