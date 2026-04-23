import type { Config } from "./config.js";
import { logger } from "./logger.js";
import type { RunSummary } from "./types.js";

/**
 * Send a Betterstack Uptime heartbeat ping after a run.
 *
 * - D-19: success → base URL; systemicFailure → /fail suffix
 * - D-20: native fetch + AbortSignal.timeout; any error swallowed
 * - D-21: no-op when URL absent or --dry-run
 * - D-22: timeout = config.HEARTBEAT_TIMEOUT_MS (default 10000ms)
 * - D-23: NEVER throws; heartbeat failure never cascades to exit code (OBS-04)
 */
export async function sendHeartbeat(summary: RunSummary, config: Config): Promise<void> {
	const url = config.BETTERSTACK_HEARTBEAT_URL;
	if (!url) return; // D-21: no-op when absent

	const isDryRun = process.argv.includes("--dry-run");
	if (isDryRun) return; // D-21: no-op in dry-run

	// D-19: route to /fail suffix on systemic failure
	const pingUrl = summary.systemicFailure ? `${url}/fail` : url;

	try {
		const response = await fetch(pingUrl, {
			// GET is the default method — Betterstack Uptime docs confirm GET works
			signal: AbortSignal.timeout(config.HEARTBEAT_TIMEOUT_MS),
		});
		if (!response.ok) {
			// D-12: never log the actual URL — it contains an opaque liveness token
			logger.warn({ status: response.status, url: "[REDACTED]" }, "Heartbeat ping returned non-2xx");
		}
	} catch (err) {
		// Network error, timeout (AbortError), DNS failure — all swallowed per D-23
		// Log at warn (not error) to avoid cascading Betterstack alert logic (D-20)
		logger.warn({ err }, "Heartbeat ping failed — monitoring infrastructure issue");
	}
	// Never throws. D-23: no cascade to systemicFailure or exit code (OBS-04).
}
