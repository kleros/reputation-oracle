import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config.js";
// Note: heartbeat.ts will be created in Step 2
import { sendHeartbeat } from "../src/heartbeat.js";
import type { RunSummary } from "../src/types.js";

// Mock response factories (same style as ipfs.test.ts but simpler — no body needed)
function makeOkResponse(): Response {
	return { ok: true, status: 200 } as unknown as Response;
}

function makeErrorResponse(status: number): Response {
	return { ok: false, status } as unknown as Response;
}

// Minimal config stub — only the fields sendHeartbeat uses
const mockConfig = {
	BETTERSTACK_HEARTBEAT_URL: "https://uptime.betterstack.com/api/v1/heartbeat/test123abc",
	HEARTBEAT_TIMEOUT_MS: 1000,
} as unknown as Config;

// Successful run summary — systemicFailure absent
const successSummary: RunSummary = {
	itemsFetched: 5,
	valid: 5,
	actions: 0,
	txSent: 0,
	errors: 0,
	durationMs: 100,
	skipped: 0,
};

// Failed run summary — systemicFailure present
const failureSummary: RunSummary = {
	...successSummary,
	systemicFailure: "balance_below_threshold",
};

describe("sendHeartbeat", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		// Stubs cleaned up automatically by bot/vitest.config.ts (unstubGlobals: true)
		vi.unstubAllGlobals();
	});

	it("sends GET to base URL on success run (Test 1)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeOkResponse());
		await sendHeartbeat(successSummary, mockConfig);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
		expect(globalThis.fetch).toHaveBeenCalledWith(
			mockConfig.BETTERSTACK_HEARTBEAT_URL,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("sends GET to /fail URL when systemicFailure is present (Test 2)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeOkResponse());
		await sendHeartbeat(failureSummary, mockConfig);
		expect(globalThis.fetch).toHaveBeenCalledOnce();
		expect(globalThis.fetch).toHaveBeenCalledWith(
			`${mockConfig.BETTERSTACK_HEARTBEAT_URL}/fail`,
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("resolves undefined without throwing on network error (Test 3)", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("Network error"));
		await expect(sendHeartbeat(successSummary, mockConfig)).resolves.toBeUndefined();
	});

	it("resolves undefined without throwing on AbortError (Test 4)", async () => {
		const abortErr = new Error("The operation was aborted");
		abortErr.name = "AbortError";
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(abortErr);
		await expect(sendHeartbeat(successSummary, mockConfig)).resolves.toBeUndefined();
	});

	it("resolves undefined without throwing on non-2xx response (Test 5)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeErrorResponse(503));
		await expect(sendHeartbeat(successSummary, mockConfig)).resolves.toBeUndefined();
	});

	it("is a no-op when BETTERSTACK_HEARTBEAT_URL is absent (Test 6)", async () => {
		const configWithoutUrl = { ...mockConfig, BETTERSTACK_HEARTBEAT_URL: undefined } as unknown as Config;
		await sendHeartbeat(successSummary, configWithoutUrl);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("is a no-op when --dry-run is in process.argv (Test 7)", async () => {
		const originalArgv = process.argv;
		process.argv = [...originalArgv, "--dry-run"];
		try {
			await sendHeartbeat(successSummary, mockConfig);
			expect(globalThis.fetch).not.toHaveBeenCalled();
		} finally {
			process.argv = originalArgv;
		}
	});
});
