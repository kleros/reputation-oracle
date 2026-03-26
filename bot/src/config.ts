import { z } from "zod";

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid hex address");
const hexPrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid private key");

export const configSchema = z.object({
	CHAIN_ID: z.coerce.number().int().positive(),
	RPC_URL: z.string().url(),
	ROUTER_ADDRESS: hexAddress,
	PGTCR_ADDRESS: hexAddress,
	SUBGRAPH_URL: z.string().url(),
	BOT_PRIVATE_KEY: hexPrivateKey,
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
	const result = configSchema.safeParse(env);
	if (result.success) {
		return result.data;
	}

	// Redact private key from error output
	const safeIssues = result.error.issues.map((issue) => ({
		path: issue.path,
		message: issue.message,
		// Never log the actual private key value
		...(issue.path.includes("BOT_PRIVATE_KEY") ? { received: "[REDACTED]" } : {}),
	}));
	console.error("Config validation failed:", JSON.stringify(safeIssues, null, 2));
	process.exit(1);
}
