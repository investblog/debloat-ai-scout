/**
 * Chrome Web Store extensions watched for Google SERP selector changes.
 * Picked 2026-11-23 from the "AI Overview" niche (users / ratings / update cadence).
 */
export interface Competitor {
	id: string;
	name: string;
}

export const COMPETITORS: Competitor[] = [
	{ id: "neibhohkbmfjninidnaoacabkjonbahn", name: "Hide Google AI Overviews" },
	{ id: "eoghcliblbhjimkgnfemelcpfdnmiceo", name: "AI Content Shield" },
	{ id: "jledohjahnkncbmnfmbnaophlakhoanl", name: "Disable AI Overview" },
	{ id: "offhkehfjjijjghlohmdadpimbdklhio", name: "AI Blocker" },
	{ id: "claajpcgaehlepegbiibddifpnlokckb", name: "Pre-AI Search" },
	{ id: "ljnnjofjoemkokjfaikhafejolmlfjin", name: "AiHide" },
	{ id: "hnmjjbiimioedlmbmagkoilanplikoep", name: "Clean Search" },
	{ id: "bpgffbdgipfobnjdoikbbficmenihffg", name: "No AI Search" },
	{ id: "inhojdjgfnnpphfknlfbejchnjjnkpfl", name: "Hide Google AI-Overviews" },
	{ id: "aaafgcgohpoahgdhhgkpodjfekjgbfln", name: "Google AI Overview Hider" },
];

/** Debloat's own Google selectors — new competitor tokens are checked against this file */
export const OUR_SELECTORS_URL =
	"https://raw.githubusercontent.com/investblog/debloat/main/src/selectors/google-search.ts";
