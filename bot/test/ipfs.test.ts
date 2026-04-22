import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadEvidenceToIPFS } from "../src/ipfs.js";
import type { EvidenceJson } from "../src/types.js";

// Mock response factories
function makeSuccessResponse(ipfsHash = "QmTestHash123", isDuplicate = false): Response {
	return {
		ok: true,
		json: async () => ({
			IpfsHash: ipfsHash,
			PinSize: 100,
			Timestamp: "2026-04-21T00:00:00.000Z",
			isDuplicate,
		}),
	} as unknown as Response;
}

function makeErrorResponse(status: number, body: { error?: string } = { error: "test error" }): Response {
	return {
		ok: false,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

function makeAbortError(): Error {
	const err = new Error("The operation was aborted");
	err.name = "AbortError";
	return err;
}

function makeTypeError(): TypeError {
	const err = new TypeError("fetch failed");
	return err; // name is already "TypeError"
}

// Test fixtures
const mockEvidence: EvidenceJson = {
	schema: "kleros-reputation-oracle/v1",
	agentRegistry: "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e",
	agentId: "1",
	clientAddress: "eip155:11155111:0x0000000000000000000000000000000000000001",
	createdAt: "2026-04-21T00:00:00.000Z",
	value: 95,
	valueDecimals: 0,
	tag1: "verified",
	tag2: "kleros-agent-registry",
	kleros: {
		pgtcrAddress: "0x3162df9669affa8b6b6ff2147afa052249f00447",
		pgtcrItemId: "0xabc",
		stakeAmount: "1.0",
		stakeToken: "WETH",
		disputeId: null,
		ruling: null,
	},
};

const mockMetadata = {
	name: "kro-v1/11155111/1/0xabc",
	keyvalues: { agentId: "1", chainId: "11155111", pgtcrItemId: "0xabc", scenario: "verified" as const },
};

describe("uploadEvidenceToIPFS", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.useRealTimers();
		// Stubs cleaned up automatically by bot/vitest.config.ts (unstubGlobals: true)
	});

	it("returns cid and gatewayUrl on success (Test 1)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeSuccessResponse());
		const promise = uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result.cid).toBe("QmTestHash123");
		expect(result.gatewayUrl).toBe("https://cdn.kleros.link/ipfs/QmTestHash123");
		expect(result.size).toBe(100);
		expect(result.timestamp).toBe("2026-04-21T00:00:00.000Z");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("treats isDuplicate=true as success and returns same CID (Test 2)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeSuccessResponse("QmTestHash123", true));
		const promise = uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result.cid).toBe("QmTestHash123");
		expect(result.gatewayUrl).toBe("https://cdn.kleros.link/ipfs/QmTestHash123");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("throws with errorClass=auth on 401 (Test 3)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeErrorResponse(401));
		// Use Promise.all to consume rejection immediately — prevents unhandled rejection warning
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "auth",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("throws with errorClass=auth on 403 (Test 4)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeErrorResponse(403));
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "auth",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("throws with errorClass=rate-limit on 429 after 1 retry (Test 5)", async () => {
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(makeErrorResponse(429))
			.mockResolvedValueOnce(makeErrorResponse(429));
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "rate-limit",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it("retries once on 500, returns cid on success (Test 6)", async () => {
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(makeErrorResponse(500))
			.mockResolvedValueOnce(makeSuccessResponse());
		const promise = uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result.cid).toBe("QmTestHash123");
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it("throws with errorClass=server after 500 retry exhausted (Test 7)", async () => {
		vi.mocked(globalThis.fetch)
			.mockResolvedValueOnce(makeErrorResponse(500))
			.mockResolvedValueOnce(makeErrorResponse(500));
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "server",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it("throws with errorClass=network on AbortError (timeout) (Test 8)", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(makeAbortError());
		// Use Promise.all to consume the rejection before it becomes unhandled
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "network",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("throws with errorClass=network on TypeError (DNS failure) (Test 9)", async () => {
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(makeTypeError());
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "network",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("fetch called once for non-retry errors (401, AbortError, TypeError) (Test 10)", async () => {
		// Verify 401 is not retried
		vi.mocked(globalThis.fetch).mockResolvedValueOnce(makeErrorResponse(401));
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "auth",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		vi.clearAllMocks();
		vi.stubGlobal("fetch", vi.fn());

		// Verify AbortError is not retried
		vi.mocked(globalThis.fetch).mockRejectedValueOnce(makeAbortError());
		await Promise.all([
			expect(uploadEvidenceToIPFS(mockEvidence, mockMetadata, "test-jwt", 5000)).rejects.toMatchObject({
				errorClass: "network",
			}),
			vi.runAllTimersAsync(),
		]);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
});
