import {
	ContractFunctionExecutionError,
	ContractFunctionRevertedError,
	HttpRequestError,
	type PublicClient,
	WaitForTransactionReceiptTimeoutError,
	type WalletClient,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeActions } from "../src/chain.js";
import type { Config } from "../src/config.js";
import type { Action, ShutdownHolder, ValidatedItem } from "../src/types.js";

// Minimal config with the new fields
const mockConfig = {
	CHAIN_ID: 11155111,
	RPC_URL: "http://localhost:8545",
	ROUTER_ADDRESS: "0x0000000000000000000000000000000000000001",
	PGTCR_ADDRESS: "0x0000000000000000000000000000000000000002",
	SUBGRAPH_URL: "http://subgraph.example.com",
	BOT_PRIVATE_KEY: "0x" + "a".repeat(64),
	LOG_LEVEL: "silent",
	TX_RECEIPT_TIMEOUT_MS: 5000,
	MIN_BALANCE_WEI: 5_000_000_000_000_000n,
} as unknown as Config;

const mockAccount = { address: "0x1234567890123456789012345678901234567890" as `0x${string}` };

function makeMockPublicClient() {
	return {
		estimateContractGas: vi.fn(),
		waitForTransactionReceipt: vi.fn(),
		getBalance: vi.fn(),
		getTransactionCount: vi.fn().mockResolvedValue(0),
	} as unknown as PublicClient;
}

function makeMockWalletClient() {
	return {
		writeContract: vi.fn(),
		account: mockAccount,
		chain: { id: 11155111 },
	} as unknown as WalletClient;
}

function makeItem(overrides: Partial<ValidatedItem> = {}): ValidatedItem {
	return {
		agentId: 1n,
		itemID: "0xabc",
		status: "Submitted",
		latestDisputeOutcome: null,
		pgtcrItemId: "0xabc",
		stake: "1000000000000000000",
		disputeId: null,
		...overrides,
	};
}

function makeAction(agentId = 1n): Action {
	return {
		type: "submitPositiveFeedback",
		agentId,
		pgtcrItemId: "0xabc",
		item: makeItem({ agentId }),
	};
}

function makeRevertError(): ContractFunctionExecutionError {
	const revert = new ContractFunctionRevertedError({
		abi: [],
		functionName: "test",
		data: undefined,
	});
	return new ContractFunctionExecutionError(revert, {
		abi: [],
		functionName: "test",
		args: [],
		contractAddress: "0x0000000000000000000000000000000000000000",
	});
}

describe("executeActions — differentiated failure policy", () => {
	let publicClient: PublicClient;
	let walletClient: WalletClient;
	let shutdownHolder: ShutdownHolder;

	beforeEach(() => {
		vi.clearAllMocks();
		publicClient = makeMockPublicClient();
		walletClient = makeMockWalletClient();
		shutdownHolder = { shutdown: false }; // fresh per test (Pitfall E)
	});

	it("returns empty result for empty actions array", async () => {
		const result = await executeActions(walletClient, publicClient, [], mockConfig, shutdownHolder);
		expect(result).toEqual({ skipped: 0, txSent: 0 });
	});

	it("SC-1a: skips action on gas estimation revert, continues to next action", async () => {
		const action1 = makeAction(1n);
		const action2 = makeAction(2n);
		vi.mocked(publicClient.estimateContractGas).mockRejectedValueOnce(makeRevertError()).mockResolvedValueOnce(21000n);
		vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xhash1" as `0x${string}`);
		vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

		const result = await executeActions(walletClient, publicClient, [action1, action2], mockConfig, shutdownHolder);

		expect(result.skipped).toBe(1);
		expect(result.txSent).toBe(1);
		expect(result.systemicFailure).toBeUndefined();
	});

	it("SC-1b: skips action after gas estimation exhausts 3 retries", async () => {
		vi.useFakeTimers();
		const action1 = makeAction(1n);
		const action2 = makeAction(2n);
		vi.mocked(publicClient.estimateContractGas)
			.mockRejectedValueOnce(new HttpRequestError({ url: "http://rpc", status: 503, body: {} }))
			.mockRejectedValueOnce(new HttpRequestError({ url: "http://rpc", status: 503, body: {} }))
			.mockRejectedValueOnce(new HttpRequestError({ url: "http://rpc", status: 503, body: {} }))
			.mockResolvedValueOnce(21000n);
		vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xhash2" as `0x${string}`);
		vi.mocked(publicClient.waitForTransactionReceipt).mockResolvedValueOnce({ status: "success" } as any);

		const promise = executeActions(walletClient, publicClient, [action1, action2], mockConfig, shutdownHolder);
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(result.skipped).toBe(1);
		expect(result.txSent).toBe(1);
		expect(result.systemicFailure).toBeUndefined();
		vi.useRealTimers();
	});

	it("SC-2: returns systemicFailure=receipt_timeout on receipt timeout", async () => {
		const action = makeAction(1n);
		vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(21000n);
		vi.mocked(walletClient.writeContract).mockResolvedValueOnce("0xdeadbeef" as `0x${string}`);
		vi.mocked(publicClient.waitForTransactionReceipt).mockRejectedValueOnce(
			new WaitForTransactionReceiptTimeoutError({ hash: "0xdeadbeef" as `0x${string}` }),
		);

		const result = await executeActions(walletClient, publicClient, [action], mockConfig, shutdownHolder);

		expect(result.systemicFailure).toBe("receipt_timeout");
		expect(result.txSent).toBe(0);
	});

	it("skips action when receipt.status is reverted", async () => {
		const action1 = makeAction(1n);
		const action2 = makeAction(2n);
		vi.mocked(publicClient.estimateContractGas).mockResolvedValue(21000n);
		vi.mocked(walletClient.writeContract)
			.mockResolvedValueOnce("0xhash1" as `0x${string}`)
			.mockResolvedValueOnce("0xhash2" as `0x${string}`);
		vi.mocked(publicClient.waitForTransactionReceipt)
			.mockResolvedValueOnce({ status: "reverted" } as any)
			.mockResolvedValueOnce({ status: "success" } as any);

		const result = await executeActions(walletClient, publicClient, [action1, action2], mockConfig, shutdownHolder);

		expect(result.skipped).toBe(1);
		expect(result.txSent).toBe(1);
		expect(result.systemicFailure).toBeUndefined();
	});

	it("SC-4: finishes action 1 when shutdown flag set during action 1, skips action 2", async () => {
		const action1 = makeAction(1n);
		const action2 = makeAction(2n);
		vi.mocked(publicClient.estimateContractGas).mockResolvedValue(21000n);
		vi.mocked(walletClient.writeContract).mockResolvedValue("0xhash1" as `0x${string}`);
		vi.mocked(publicClient.waitForTransactionReceipt).mockImplementationOnce(async () => {
			// Set shutdown flag AFTER action 1 completes
			shutdownHolder.shutdown = true;
			return { status: "success" } as any;
		});

		const result = await executeActions(walletClient, publicClient, [action1, action2], mockConfig, shutdownHolder);

		expect(result.txSent).toBe(1);
		expect(walletClient.writeContract).toHaveBeenCalledTimes(1);
		expect(result.systemicFailure).toBeUndefined();
	});

	it("returns systemicFailure=submission_failed_non_revert on non-revert writeContract error", async () => {
		const action = makeAction(1n);
		vi.mocked(publicClient.estimateContractGas).mockResolvedValueOnce(21000n);
		vi.mocked(walletClient.writeContract).mockRejectedValueOnce(
			new HttpRequestError({ url: "http://rpc", status: 429, body: {} }),
		);

		const result = await executeActions(walletClient, publicClient, [action], mockConfig, shutdownHolder);

		expect(result.systemicFailure).toBe("submission_failed_non_revert");
	});
});
