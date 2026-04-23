import { z } from "zod";
import { logger } from "./logger.js";

const hexAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid hex address");
const hexPrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid private key");

export const configSchema = z.object({
	CHAIN_ID: z.coerce.number().int().positive(),
	RPC_URL: z.string().url(),
	ROUTER_ADDRESS: hexAddress,
	PGTCR_ADDRESS: hexAddress,
	SUBGRAPH_URL: z.string().url(),
	BOT_PRIVATE_KEY: hexPrivateKey,
	LOG_LEVEL: z.string().optional().default("info"),
	TX_RECEIPT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(120_000),
	MIN_BALANCE_WEI: z.coerce.bigint().optional().default(5_000_000_000_000_000n),
	PINATA_JWT: z.string().optional(),
	PINATA_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(30_000),
	BETTERSTACK_SOURCE_TOKEN: z.string().optional(),
	BETTERSTACK_HEARTBEAT_URL: z.string().url().optional(),
	HEARTBEAT_TIMEOUT_MS: z.coerce.number().int().positive().optional().default(10_000),
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
		// Never log the actual private key, JWT, or Betterstack token/URL values
		...(issue.path.includes("BOT_PRIVATE_KEY") ||
		issue.path.includes("PINATA_JWT") ||
		issue.path.includes("BETTERSTACK_SOURCE_TOKEN") ||
		issue.path.includes("BETTERSTACK_HEARTBEAT_URL")
			? { received: "[REDACTED]" }
			: {}),
	}));
	logger.error({ issues: safeIssues }, "Config validation failed");
	process.exit(1);
}
