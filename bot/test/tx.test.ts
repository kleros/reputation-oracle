import {
	ContractFunctionExecutionError,
	ContractFunctionRevertedError,
	HttpRequestError,
	type PublicClient,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { estimateGasWithRetry, isRevertError, isTransientError } from "../src/tx.js";

// Helper: build a wrapped revert error as viem does internally
function makeRevertError(): ContractFunctionExecutionError {
	const revert = new ContractFunctionRevertedError({
		abi: [],
		functionName: "test",
	});
	return new ContractFunctionExecutionError(revert, {
		abi: [],
		functionName: "test",
		args: [],
		contractAddress: "0x0000000000000000000000000000000000000000",
	});
}

function makeHttpError(): HttpRequestError {
	return new HttpRequestError({ url: "http://rpc.example.com", status: 503, body: {} });
}

describe("estimateGasWithRetry", () => {
	let mockPublicClient: Pick<PublicClient, "estimateContractGas">;
	const dummyParams = {
		address: "0x0000000000000000000000000000000000000000" as `0x${string}`,
		abi: [] as const,
		functionName: "test" as never,
		args: [] as never,
		account: "0x0000000000000000000000000000000000000001" as `0x${string}`,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		mockPublicClient = {
			estimateContractGas: vi.fn(),
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns gas estimate on first success", async () => {
		vi.mocked(mockPublicClient.estimateContractGas).mockResolvedValueOnce(21000n);
		const promise = estimateGasWithRetry(mockPublicClient as PublicClient, dummyParams);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result).toBe(21000n);
		expect(mockPublicClient.estimateContractGas).toHaveBeenCalledTimes(1);
	});

	it("retries on HttpRequestError and succeeds on 3rd attempt", async () => {
		vi.mocked(mockPublicClient.estimateContractGas)
			.mockRejectedValueOnce(makeHttpError())
			.mockRejectedValueOnce(makeHttpError())
			.mockResolvedValueOnce(42000n);
		const promise = estimateGasWithRetry(mockPublicClient as PublicClient, dummyParams);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result).toBe(42000n);
		expect(mockPublicClient.estimateContractGas).toHaveBeenCalledTimes(3);
	});

	it("throws after exhausting 3 attempts on transient error", async () => {
		vi.mocked(mockPublicClient.estimateContractGas)
			.mockImplementationOnce(async () => {
				throw makeHttpError();
			})
			.mockImplementationOnce(async () => {
				throw makeHttpError();
			})
			.mockImplementationOnce(async () => {
				throw makeHttpError();
			});
		// Run timers concurrently with the assertion so the rejection is consumed
		// before Node.js marks it as unhandled (vitest 4 strict rejection detection)
		await Promise.all([
			expect(estimateGasWithRetry(mockPublicClient as PublicClient, dummyParams)).rejects.toThrow(),
			vi.runAllTimersAsync(),
		]);
		expect(mockPublicClient.estimateContractGas).toHaveBeenCalledTimes(3);
	});

	it("throws immediately on revert error without retrying", async () => {
		vi.mocked(mockPublicClient.estimateContractGas).mockRejectedValueOnce(makeRevertError());
		// Revert causes immediate throw — no timers needed, consume rejection right away
		await expect(estimateGasWithRetry(mockPublicClient as PublicClient, dummyParams)).rejects.toThrow();
		expect(mockPublicClient.estimateContractGas).toHaveBeenCalledTimes(1);
	});

	it("throws immediately on non-transient non-revert error without retrying (WR-03)", async () => {
		// A plain Error is not a BaseError — isTransientError returns false
		const plainErr = new Error("unexpected programming error");
		vi.mocked(mockPublicClient.estimateContractGas).mockRejectedValueOnce(plainErr);
		await expect(estimateGasWithRetry(mockPublicClient as PublicClient, dummyParams)).rejects.toThrow(
			"unexpected programming error",
		);
		// Must not retry — only one call
		expect(mockPublicClient.estimateContractGas).toHaveBeenCalledTimes(1);
	});
});

describe("isRevertError", () => {
	it("returns true for wrapped ContractFunctionRevertedError", () => {
		expect(isRevertError(makeRevertError())).toBe(true);
	});

	it("returns true for direct ContractFunctionRevertedError", () => {
		const revert = new ContractFunctionRevertedError({
			abi: [],
			functionName: "test",
		});
		expect(isRevertError(revert)).toBe(true);
	});

	it("returns false for HttpRequestError", () => {
		expect(isRevertError(makeHttpError())).toBe(false);
	});

	it("returns false for non-Error values", () => {
		expect(isRevertError("string error")).toBe(false);
		expect(isRevertError(null)).toBe(false);
	});
});

describe("isTransientError", () => {
	it("returns true for HttpRequestError", () => {
		expect(isTransientError(makeHttpError())).toBe(true);
	});

	it("returns false for ContractFunctionRevertedError", () => {
		expect(isTransientError(makeRevertError())).toBe(false);
	});

	it("returns false for non-BaseError", () => {
		expect(isTransientError(new Error("plain"))).toBe(false);
		expect(isTransientError(null)).toBe(false);
	});
});
