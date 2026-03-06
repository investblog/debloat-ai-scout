import { Hono } from "hono";
import type { Env } from "../index";
import type { DigestResponse } from "../../../src/shared/types";
import { getWeekKey } from "./report";

export function digestRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/**
	 * Weekly digest for a specific installation.
	 * GET /scout/digest?id={installId}&week={2026-W10}
	 */
	router.get("/", async (c) => {
		const installId = c.req.query("id");
		const weekParam = c.req.query("week");
		const weekKey = weekParam ?? getWeekKey();

		// Period dates from ISO week
		const { from, to } = weekBounds(weekKey);

		// Global stats
		const globalRaw = await c.env.STATE.get(`week:${weekKey}:global`);
		const global = globalRaw
			? JSON.parse(globalRaw) as { reported: number; issued: number; fixed: number }
			: { reported: 0, issued: 0, fixed: 0 };

		// Per-user stats
		let you = { reported: 0, issued: 0 };
		if (installId) {
			const userRaw = await c.env.STATE.get(`week:${weekKey}:${installId}`);
			if (userRaw) {
				you = JSON.parse(userRaw) as { reported: number; issued: number };
			}
		}

		// Format period string
		const periodStr = formatPeriod(from, to);

		// Build notification message
		const youParts = [];
		if (you.reported > 0) youParts.push(`${you.reported} reported`);
		if (you.issued > 0) youParts.push(`${you.issued} accepted`);
		const youMsg = youParts.length > 0
			? `You: ${youParts.join(" · ")}`
			: "No reports this week";

		const globalParts = [];
		if (global.reported > 0) globalParts.push(`${global.reported} reports`);
		if (global.issued > 0) globalParts.push(`${global.issued} new`);
		if (global.fixed > 0) globalParts.push(`${global.fixed} fixed`);
		const globalMsg = globalParts.length > 0
			? `Community: ${globalParts.join(" · ")}`
			: "";

		const resp: DigestResponse = {
			period: { from, to },
			you,
			global,
			notification: {
				title: "Your Debloat Scout Week",
				message: youMsg,
				context: globalMsg || periodStr,
			},
		};

		return c.json(resp);
	});

	return router;
}

/** Get Monday and Sunday dates for an ISO week key like "2026-W10" */
function weekBounds(weekKey: string): { from: string; to: string } {
	const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
	if (!match) {
		const now = new Date();
		const day = now.getDay() || 7;
		const monday = new Date(now);
		monday.setDate(now.getDate() - day + 1);
		const sunday = new Date(monday);
		sunday.setDate(monday.getDate() + 6);
		return {
			from: monday.toISOString().slice(0, 10),
			to: sunday.toISOString().slice(0, 10),
		};
	}

	const year = Number.parseInt(match[1]!, 10);
	const week = Number.parseInt(match[2]!, 10);

	// Jan 4 is always in week 1 of ISO year
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const dayOfWeek = jan4.getUTCDay() || 7;
	const monday = new Date(jan4);
	monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
	const sunday = new Date(monday);
	sunday.setUTCDate(monday.getUTCDate() + 6);

	return {
		from: monday.toISOString().slice(0, 10),
		to: sunday.toISOString().slice(0, 10),
	};
}

/** Format period: "Mar 1–7, 2026" */
function formatPeriod(from: string, to: string): string {
	const f = new Date(from + "T00:00:00Z");
	const t = new Date(to + "T00:00:00Z");
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const fMonth = months[f.getUTCMonth()]!;
	const tMonth = months[t.getUTCMonth()]!;
	const year = f.getUTCFullYear();

	if (fMonth === tMonth) {
		return `${fMonth} ${f.getUTCDate()}–${t.getUTCDate()}, ${year}`;
	}
	return `${fMonth} ${f.getUTCDate()} – ${tMonth} ${t.getUTCDate()}, ${year}`;
}
