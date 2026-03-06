/** Debloat detection categories */
export type CategoryId = "ai" | "sponsored" | "shopping" | "annoyances" | "telemetry";

/** Extended category including scout-specific */
export type DetectionCategory = CategoryId | "unknown_candidate";

/** Browser targets */
export type BrowserTarget = "chrome" | "edge" | "firefox";

/** Scan profile — atomic unit of comparison */
export interface ScanProfile {
	surface: string;
	browser: BrowserTarget;
	locale: string;
	viewport: { width: number; height: number };
	scenario: string;
}

/** Scan profile key for storage */
export function profileKey(profile: ScanProfile): string {
	return `${profile.surface}:${profile.browser}:${profile.locale}`;
}

/** Candidate block extracted from DOM */
export interface CandidateBlock {
	/** Outer HTML of the element */
	html: string;
	/** CSS selector path to the element */
	selector: string;
	/** Text content (trimmed) */
	textContent: string;
	/** Tag name */
	tagName: string;
	/** Class list */
	classes: string[];
	/** Role attribute */
	role: string | null;
	/** Aria-label */
	ariaLabel: string | null;
	/** DOM depth from body */
	depth: number;
	/** Parent tag name */
	parentTag: string | null;
	/** Number of siblings */
	siblingCount: number;
	/** Bounding box */
	boundingBox: { x: number; y: number; width: number; height: number } | null;
	/** Whether element is in shadow DOM */
	inShadowDom: boolean;
}

/** Heuristic signal annotations */
export interface SignalAnnotation {
	type: "keyword" | "placement" | "action_button" | "shadow_dom" | "selector_mismatch";
	value: string;
	score: number;
}

/** Scored candidate */
export interface ScoredCandidate {
	block: CandidateBlock;
	signals: SignalAnnotation[];
	totalScore: number;
	category: DetectionCategory;
	blockFingerprint: string;
	layoutFingerprint: string;
}

/** DOM snapshot for a single scan */
export interface DomSnapshot {
	url: string;
	title: string;
	timestamp: string;
	reducedHtml: string;
	candidates: CandidateBlock[];
}

/** Run metadata */
export interface RunMetadata {
	runId: string;
	timestamp: string;
	profiles: string[];
	configHash: string;
	candidateCount: number;
	issuesCreated: number;
}

/** Baseline entry stored in KV */
export interface BaselineEntry {
	profileKey: string;
	snapshot: DomSnapshot;
	fingerprints: { block: string[]; layout: string[] };
	metadata: { timestamp: string; runId: string };
}

/** Feedback registry entry */
export interface FeedbackEntry {
	blockFingerprint: string;
	resolution: "false-positive" | "not-relevant" | "expected-variant";
	surface: string;
	browser: BrowserTarget;
	locale: string;
	scope: "ttl" | "permanent";
	createdAt: string;
	expiresAt: string | null;
}

/** Report sent by the Debloat extension (opt-in telemetry) */
export interface ExtensionReport {
	/** Surface identifier (e.g. "google-search", "bing-search") */
	surface: string;
	/** Page URL (normalized, no PII) */
	pageUrl: string;
	/** Browser the extension runs in */
	browser: BrowserTarget;
	/** Navigator language */
	locale: string;
	/** Extension version */
	extensionVersion: string;
	/** Viewport dimensions */
	viewport: { width: number; height: number };
	/** Raw candidate blocks extracted from the page */
	candidates: CandidateBlock[];
	/** How many elements the extension hid via CSS/DOM */
	hiddenCount: number;
	/** Anonymous installation ID (UUID, generated on first install) */
	installId: string;
}

/** Notification payload — ready to show via chrome.notifications */
export interface ScoutNotification {
	title: string;
	message: string;
	context: string;
	issueUrl?: string;
}

/** Report response from Worker to extension */
export interface ReportResponse {
	ok: boolean;
	result: "issues_created" | "no_novel" | "all_filtered" | "no_candidates" | "deduped" | "issue_creation_failed" | "no_github_token" | "first_scan";
	raw: number;
	actionable: number;
	novel: number;
	issued: number;
	isFirstScan: boolean;
	issues: Array<{ number: number; url: string }>;
	notification: ScoutNotification;
	errors?: string[];
}

/** Per-installation stats stored in KV */
export interface InstallStats {
	reported: number;
	issued: number;
	lastReport: string;
	firstReport: string;
	surfaces: string[];
}

/** Weekly digest response */
export interface DigestResponse {
	period: { from: string; to: string };
	you: { reported: number; issued: number };
	global: { reported: number; issued: number; fixed: number };
	notification: ScoutNotification;
}

/** Issue type */
export type IssueType =
	| "new_ai_surface"
	| "selector_regression"
	| "unknown_candidate_requires_review";

/** Scout issue payload */
export interface ScoutIssue {
	title: string;
	type: IssueType;
	surface: string;
	browser: BrowserTarget;
	locale: string;
	score: number;
	domSnippet: string;
	screenshotUrl: string;
	explanation: string;
	category: DetectionCategory;
	blockFingerprint: string;
	layoutFingerprint: string;
}
