import { Hono } from "hono";
import type { Env } from "../index";

export function baselineRoutes() {
	const router = new Hono<{ Bindings: Env }>();

	/** Get stable baseline for a profile */
	router.get("/:profileKey", async (c) => {
		const key = `baseline:${c.req.param("profileKey")}`;
		const value = await c.env.STATE.get(key);
		if (!value) {
			return c.json({ error: "No baseline found" }, 404);
		}
		return c.json(JSON.parse(value));
	});

	/** Get candidate baseline for a profile */
	router.get("/:profileKey/candidate", async (c) => {
		const key = `baseline:${c.req.param("profileKey")}:candidate`;
		const value = await c.env.STATE.get(key);
		if (!value) {
			return c.json({ error: "No candidate baseline" }, 404);
		}
		return c.json(JSON.parse(value));
	});

	/** Create or update stable baseline */
	router.put("/:profileKey", async (c) => {
		const key = `baseline:${c.req.param("profileKey")}`;
		const body = await c.req.text();
		await c.env.STATE.put(key, body);
		return c.json({ ok: true });
	});

	/** Create or update candidate baseline */
	router.put("/:profileKey/candidate", async (c) => {
		const key = `baseline:${c.req.param("profileKey")}:candidate`;
		const body = await c.req.text();
		await c.env.STATE.put(key, body);
		return c.json({ ok: true });
	});

	/** Promote candidate → stable */
	router.post("/:profileKey/promote", async (c) => {
		const profileKey = c.req.param("profileKey");
		const candidateKey = `baseline:${profileKey}:candidate`;
		const stableKey = `baseline:${profileKey}`;

		const candidate = await c.env.STATE.get(candidateKey);
		if (!candidate) {
			return c.json({ error: "No candidate baseline to promote" }, 404);
		}

		await c.env.STATE.put(stableKey, candidate);
		await c.env.STATE.delete(candidateKey);
		return c.json({ ok: true, promoted: profileKey });
	});

	return router;
}
