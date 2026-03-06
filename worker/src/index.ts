import { Hono } from "hono";
import { cors } from "hono/cors";
import { baselineRoutes } from "./routes/baseline";
import { dedupRoutes } from "./routes/dedup";
import { scanRoutes } from "./routes/scan";
import { webhookRoutes } from "./routes/webhook";

export interface Env {
	STATE: KVNamespace;
	ARTIFACTS: R2Bucket;
	GITHUB_REPO_OWNER: string;
	GITHUB_REPO_NAME: string;
	GITHUB_TOKEN?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

app.get("/", (c) => c.json({ service: "debloat-ai-scout", status: "ok" }));

app.route("/baseline", baselineRoutes());
app.route("/scan", scanRoutes());
app.route("/dedup", dedupRoutes());
app.route("/webhook", webhookRoutes());

export default app;
