import {
	type Chain,
	type EstimateContractGasParameters,
	http,
	type PublicClient,
	TransactionExecutionError,
	createPublicClient as viemCreatePublicClient,
	createWalletClient as viemCreateWalletClient,
	WaitForTransactionReceiptTimeoutError,
	type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { routerAbi } from "./abi/router.js";
import type { Config } from "./config.js";
import { buildNegativeEvidence, buildPositiveEvidence } from "./evidence.js";
import { createChildLogger } from "./logger.js";
import { estimateGasWithRetry, isRevertError } from "./tx.js";
import { type Action, type ExecuteActionsResult, FeedbackType, type ShutdownHolder } from "./types.js";

const log = createChildLogger("chain");

function buildChain(config: Config): Chain {
	return {
		id: config.CHAIN_ID,
		name: "custom",
		nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
		rpcUrls: {
			default: { http: [config.RPC_URL] },
		},
		contracts: {
			multicall3: {
				address: "0xcA11bde05977b3631167028862bE2a173976CA11",
			},
		},
	};
}

/**
 * Create a viem PublicClient with Multicall3 batching enabled.
 * batchSize is in BYTES (not call count) per Pitfall 7.
 */
export function createViemPublicClient(config: Config): PublicClient {
	return viemCreatePublicClient({
		chain: buildChain(config),
		transport: http(config.RPC_URL),
		batch: {
			multicall: {
				batchSize: 1024 * 200, // ~200KB per batch, not call count (Pitfall 7)
			},
		},
	});
}

/**
 * Create a viem WalletClient for transaction submission.
 */
export function createViemWalletClient(config: Config): WalletClient {
	const account = privateKeyToAccount(config.BOT_PRIVATE_KEY as `0x${string}`);
	return viemCreateWalletClient({
		account,
		chain: buildChain(config),
		transport: http(config.RPC_URL),
	});
}

/**
 * Batch-read feedbackType for all agentIds via Multicall3.
 * Returns Map<bigint, FeedbackType>. Failed reads default to FeedbackType.None
 * (conservative: will trigger positive feedback for Submitted items, which is correct).
 */
export async function readRouterStates(
	client: PublicClient,
	routerAddress: string,
	agentIds: bigint[],
): Promise<Map<bigint, FeedbackType>> {
	const map = new Map<bigint, FeedbackType>();
	if (agentIds.length === 0) return map;

	const results = await client.multicall({
		contracts: agentIds.map((id) => ({
			address: routerAddress as `0x${string}`,
			abi: routerAbi,
			functionName: "feedbackType" as const,
			args: [id] as const,
		})),
	});

	for (let i = 0; i < agentIds.length; i++) {
		const result = results[i];
		if (result.status === "success") {
			map.set(agentIds[i], result.result as FeedbackType);
		} else {
			// Conservative default: treat as None
			map.set(agentIds[i], FeedbackType.None);
		}
	}

	log.debug({ count: agentIds.length }, "Read router states");
	return map;
}

/**
 * Execute actions sequentially with differentiated failure policy (D-01).
 * - Item-specific failures (gas revert, submission revert, receipt revert, gas exhausted): skip + continue
 * - Systemic failures (receipt timeout, non-revert submission error): return systemicFailure reason
 * - Graceful shutdown: check shutdownHolder before each action; finish current tx if in-flight
 * Returns ExecuteActionsResult (never throws for classified errors).
 */
export async function executeActions(
	walletClient: WalletClient,
	publicClient: PublicClient,
	actions: Action[],
	config: Config,
	shutdownHolder: ShutdownHolder,
): Promise<ExecuteActionsResult> {
	let skipped = 0;
	let txSent = 0;

	if (actions.length === 0) {
		log.info("No actions to execute");
		return { skipped, txSent };
	}

	const account = walletClient.account;
	if (!account) throw new Error("WalletClient has no account");

	// Fetch nonce once at start (D-09 — fetch once, increment locally)
	let nonce = await publicClient.getTransactionCount({
		address: account.address,
	});

	for (const action of actions) {
		// Check shutdown flag before starting each action (D-03/D-05)
		if (shutdownHolder.shutdown) {
			log.info("Shutdown requested, skipping remaining actions");
			break;
		}

		const agentIdStr = action.agentId.toString();

		// Step 1: Gas estimation with retry (D-08/D-09/D-10)
		// Build evidence and feedbackURI ONCE per action so gas estimate and writeContract
		// use identical calldata (WR-01 — avoids createdAt timestamp drift between the two calls).
		let gasEstimate: bigint;
		let gasParams: EstimateContractGasParameters;
		let feedbackURI: string | undefined;

		if (action.type === "submitPositiveFeedback") {
			const evidence = buildPositiveEvidence({
				agentId: action.agentId,
				pgtcrItemId: action.pgtcrItemId,
				pgtcrAddress: config.PGTCR_ADDRESS,
				routerAddress: config.ROUTER_ADDRESS,
				chainId: config.CHAIN_ID,
				stake: action.item.stake,
			});
			// TODO(06-04): replace with CID from uploadEvidenceToIPFS() in the prepare pass.
			// buildFeedbackURI now expects a CID string; interim: encode evidence as data URI here.
			feedbackURI = `data:application/json;base64,${Buffer.from(JSON.stringify(evidence)).toString("base64")}`;
			gasParams = {
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "submitPositiveFeedback",
				args: [action.agentId, action.pgtcrItemId as `0x${string}`, feedbackURI],
				account,
			};
		} else if (action.type === "submitNegativeFeedback") {
			const evidence = buildNegativeEvidence({
				agentId: action.agentId,
				pgtcrItemId: action.item.pgtcrItemId,
				pgtcrAddress: config.PGTCR_ADDRESS,
				routerAddress: config.ROUTER_ADDRESS,
				chainId: config.CHAIN_ID,
				stake: action.item.stake,
				disputeId: action.item.disputeId,
			});
			// TODO(06-04): replace with CID from uploadEvidenceToIPFS() in the prepare pass.
			feedbackURI = `data:application/json;base64,${Buffer.from(JSON.stringify(evidence)).toString("base64")}`;
			gasParams = {
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "submitNegativeFeedback",
				args: [action.agentId, feedbackURI],
				account,
			};
		} else {
			gasParams = {
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "revokeOnly",
				args: [action.agentId],
				account,
			};
		}

		try {
			gasEstimate = await estimateGasWithRetry(publicClient, gasParams);
		} catch (err) {
			// isRevertError: immediate throw from estimateGasWithRetry (no retry happened)
			// !isRevertError: exhausted retries on transient error
			const reason = isRevertError(err) ? "gas_estimation_reverted" : "gas_estimation_exhausted";
			log.warn(
				{
					action: action.type,
					agentId: agentIdStr,
					reason,
					...(reason === "gas_estimation_exhausted" ? { attempts: 3 } : {}),
					lastError: err instanceof Error ? err.message : String(err),
				},
				"Action skipped",
			);
			skipped++;
			continue;
		}

		// Step 2: Submit transaction — NEVER retried (D-11)
		// feedbackURI was built once above (WR-01) — reuse here so calldata is identical.
		let hash: `0x${string}`;

		try {
			if (action.type === "submitPositiveFeedback") {
				hash = await walletClient.writeContract({
					address: config.ROUTER_ADDRESS as `0x${string}`,
					abi: routerAbi,
					functionName: "submitPositiveFeedback",
					args: [action.agentId, action.pgtcrItemId as `0x${string}`, feedbackURI as string],
					nonce,
					chain: walletClient.chain,
					account,
					gas: gasEstimate,
				});
			} else if (action.type === "submitNegativeFeedback") {
				hash = await walletClient.writeContract({
					address: config.ROUTER_ADDRESS as `0x${string}`,
					abi: routerAbi,
					functionName: "submitNegativeFeedback",
					args: [action.agentId, feedbackURI as string],
					nonce,
					chain: walletClient.chain,
					account,
					gas: gasEstimate,
				});
			} else {
				hash = await walletClient.writeContract({
					address: config.ROUTER_ADDRESS as `0x${string}`,
					abi: routerAbi,
					functionName: "revokeOnly",
					args: [action.agentId],
					nonce,
					chain: walletClient.chain,
					account,
					gas: gasEstimate,
				});
			}
		} catch (err) {
			if (isRevertError(err)) {
				log.warn({ action: action.type, agentId: agentIdStr, reason: "submission_reverted" }, "Action skipped");
				skipped++;
				continue;
			}
			// Non-revert submission error: systemic stop (D-11, D-19)
			log.error(
				{
					action: action.type,
					agentId: agentIdStr,
					reason: "submission_failed_non_revert",
					lastError: err instanceof Error ? err.message : String(err),
				},
				"Systemic failure: tx submission failed",
			);
			return { skipped, txSent, systemicFailure: "submission_failed_non_revert" };
		}

		// Step 3: Wait for receipt (D-12/D-13/D-15)
		try {
			const receipt = await publicClient.waitForTransactionReceipt({
				hash,
				timeout: config.TX_RECEIPT_TIMEOUT_MS,
			});

			if (receipt.status === "reverted") {
				// Item-specific skip (D-15 — revises Phase 2 D-10's throw).
				// A reverted tx still consumes a nonce on-chain — advance local counter
				// so the next action does not reuse it (CR-01).
				log.warn(
					{ action: action.type, agentId: agentIdStr, txHash: hash, reason: "receipt_reverted" },
					"Action skipped",
				);
				nonce++;
				skipped++;
				continue;
			}

			// Success
			nonce++;
			txSent++;
			log.info({ txHash: hash, action: action.type, agentId: agentIdStr }, "TX confirmed");
		} catch (err) {
			if (err instanceof WaitForTransactionReceiptTimeoutError) {
				// Systemic stop — log hash from outer scope (Pitfall C: error doesn't expose hash)
				log.error(
					{
						txHash: hash,
						action: action.type,
						agentId: agentIdStr,
						timeoutMs: config.TX_RECEIPT_TIMEOUT_MS,
						reason: "receipt_timeout",
					},
					"Receipt timeout — tx may still be pending",
				);
				return { skipped, txSent, systemicFailure: "receipt_timeout" };
			}
			// Unknown receipt error: systemic stop
			log.error(
				{ txHash: hash, action: action.type, agentId: agentIdStr, reason: "receipt_null" },
				"Null or unexpected receipt error",
			);
			return { skipped, txSent, systemicFailure: "receipt_null" };
		}
	}

	return { skipped, txSent };
}
