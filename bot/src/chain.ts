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
import { buildFeedbackURI, buildNegativeEvidence, buildPositiveEvidence } from "./evidence.js";
import { type PinataMetadata, uploadEvidenceToIPFS } from "./ipfs.js";
import { createChildLogger } from "./logger.js";
import { estimateGasWithRetry, isRevertError } from "./tx.js";
import {
	type Action,
	type EvidenceJson,
	type ExecuteActionsResult,
	FeedbackType,
	type ShutdownHolder,
} from "./types.js";

const log = createChildLogger("chain");

// Internal type for the prepare pass result — NOT exported
type PreparedAction =
	| { action: Action; status: "ready"; feedbackURI: string; evidence: EvidenceJson; cid: string }
	| { action: Action; status: "skip"; reason: string }
	| { action: Action; status: "no-ipfs" }; // Scenario 3: revokeOnly — no URI needed

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
 * Structured as a prepare pass (IPFS uploads) followed by an execute pass (on-chain txs).
 *
 * Prepare pass:
 * - S1/S2: build evidence once (WR-01), upload to IPFS, produce PreparedAction { status: "ready" }
 * - S3 (revokeOnly): no IPFS needed, produce PreparedAction { status: "no-ipfs" }
 * - PINATA_JWT absent: S1/S2 get { status: "skip" }, S3 still proceeds
 * - Upload failure: item skipped, consecutiveFailures++; 3 in a row → systemicFailure
 * - Shutdown during prepare: return early, execute pass skipped
 *
 * Execute pass:
 * - Skipped actions are not submitted
 * - feedbackURI comes from PreparedAction (already ipfs://...) — NEVER rebuilt (WR-01)
 * - Item-specific failures (gas revert, submission revert, receipt revert, gas exhausted): skip + continue
 * - Systemic failures (receipt timeout, non-revert submission error): return systemicFailure reason
 *
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
	let uploadsAttempted = 0;
	let uploadsSucceeded = 0;
	let uploadsFailed = 0;
	let consecutiveFailures = 0;
	const orphanedCids: string[] = [];

	if (actions.length === 0) {
		log.info("No actions to execute");
		return { skipped, txSent };
	}

	const account = walletClient.account;
	if (!account) throw new Error("WalletClient has no account");

	// === PREPARE PASS: upload evidence to IPFS for all S1/S2 actions ===
	const prepared: PreparedAction[] = [];

	for (let i = 0; i < actions.length; i++) {
		const action = actions[i];

		// Shutdown check before each upload (D-22)
		if (shutdownHolder.shutdown) {
			log.info({ remainingActions: actions.length - i }, "Shutdown during prepare pass, skipping execute pass");
			return {
				skipped,
				txSent,
				uploadsAttempted,
				uploadsSucceeded,
				uploadsFailed,
				orphanedCids: orphanedCids.length > 0 ? orphanedCids : undefined,
			};
		}

		// Scenario 3 (revokeOnly): no IPFS needed (D-04)
		if (action.type === "revokeOnly") {
			prepared.push({ action, status: "no-ipfs" });
			continue;
		}

		// PINATA_JWT absent: skip S1/S2 actions (D-26, IPFS-05)
		if (!config.PINATA_JWT) {
			log.warn(
				{ agentId: action.agentId.toString(), actionType: action.type, reason: "PINATA_JWT not configured" },
				"Skipping action — PINATA_JWT not configured",
			);
			skipped++;
			prepared.push({ action, status: "skip", reason: "PINATA_JWT not configured" });
			continue;
		}

		// Build evidence once per action (WR-01 — captures createdAt here, NOT in execute pass)
		const pgtcrItemId = action.type === "submitPositiveFeedback" ? action.pgtcrItemId : action.item.pgtcrItemId;
		let evidence: EvidenceJson;
		if (action.type === "submitPositiveFeedback") {
			evidence = buildPositiveEvidence({
				agentId: action.agentId,
				pgtcrItemId,
				pgtcrAddress: config.PGTCR_ADDRESS,
				routerAddress: config.ROUTER_ADDRESS,
				chainId: config.CHAIN_ID,
				stake: action.item.stake,
			});
		} else {
			evidence = buildNegativeEvidence({
				agentId: action.agentId,
				pgtcrItemId,
				pgtcrAddress: config.PGTCR_ADDRESS,
				routerAddress: config.ROUTER_ADDRESS,
				chainId: config.CHAIN_ID,
				stake: action.item.stake,
				disputeId: action.item.disputeId,
			});
		}

		// Build Pinata metadata (D-29)
		const metadata: PinataMetadata = {
			name: `kro-v1/${config.CHAIN_ID}/${action.agentId.toString()}/${pgtcrItemId}`,
			keyvalues: {
				agentId: action.agentId.toString(),
				chainId: config.CHAIN_ID.toString(),
				pgtcrItemId,
				scenario: action.type === "submitPositiveFeedback" ? "verified" : "removed",
			},
		};

		uploadsAttempted++;
		try {
			const uploadResult = await uploadEvidenceToIPFS(evidence, metadata, config.PINATA_JWT, config.PINATA_TIMEOUT_MS);
			uploadsSucceeded++;
			consecutiveFailures = 0; // D-18: reset on success
			orphanedCids.push(uploadResult.cid); // track for orphan reporting (removed on successful tx)
			const feedbackURI = buildFeedbackURI(uploadResult.cid); // D-03: ipfs://<cid>
			prepared.push({ action, status: "ready", feedbackURI, evidence, cid: uploadResult.cid });
		} catch (err) {
			uploadsFailed++;
			consecutiveFailures++;
			const errorClass = (err as { errorClass?: string }).errorClass ?? "network";
			// D-32: retried=true only when failure was final after a 5xx/429 retry (server or rate-limit class).
			// Auth and network errors are never retried — retried=false for those.
			const retried = errorClass === "server" || errorClass === "rate-limit";
			log.warn(
				{
					error_class: errorClass,
					error_message: err instanceof Error ? err.message : String(err),
					agentId: action.agentId.toString(),
					pgtcrItemId,
					scenario: action.type === "submitPositiveFeedback" ? "verified" : "removed",
					actionIndex: i,
					retried,
				},
				"ipfs-upload-failed",
			);
			skipped++;
			prepared.push({ action, status: "skip", reason: "ipfs-upload-failed" });

			// D-17: 3 consecutive failures → systemic stop
			if (consecutiveFailures >= 3) {
				log.error(
					{ consecutiveFailures, reason: "pinata-unavailable" },
					"Systemic failure: 3 consecutive Pinata upload failures",
				);
				return {
					skipped,
					txSent,
					systemicFailure: "pinata-unavailable",
					uploadsAttempted,
					uploadsSucceeded,
					uploadsFailed,
					orphanedCids: orphanedCids.length > 0 ? orphanedCids : undefined,
				};
			}
		}
	}

	log.info({ uploadsAttempted, uploadsSucceeded, uploadsFailed }, "Prepare pass complete");

	// Fetch nonce once at start of execute pass (D-09 — fetch once, increment locally)
	let nonce = await publicClient.getTransactionCount({
		address: account.address,
	});

	// === EXECUTE PASS: submit on-chain transactions for all prepared actions ===
	for (const prep of prepared) {
		if (prep.status === "skip") continue; // already counted in skipped above

		// Check shutdown flag before starting each action (D-03/D-05)
		if (shutdownHolder.shutdown) {
			log.info("Shutdown requested, skipping remaining actions");
			break;
		}

		const action = prep.action;
		const agentIdStr = action.agentId.toString();
		// feedbackURI: from prepare pass (ipfs://...) or undefined for revokeOnly
		const feedbackURI = prep.status === "ready" ? prep.feedbackURI : undefined;

		// Step 1: Gas estimation with retry (D-08/D-09/D-10)
		// feedbackURI was built once in the prepare pass (WR-01) — reuse here so calldata is identical.
		let gasEstimate: bigint;
		let gasParams: EstimateContractGasParameters;

		if (action.type === "submitPositiveFeedback") {
			gasParams = {
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "submitPositiveFeedback",
				args: [action.agentId, action.pgtcrItemId as `0x${string}`, feedbackURI as string],
				account,
			};
		} else if (action.type === "submitNegativeFeedback") {
			gasParams = {
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "submitNegativeFeedback",
				args: [action.agentId, feedbackURI as string],
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
		// feedbackURI was built once in the prepare pass (WR-01) — reuse here so calldata is identical.
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
			return {
				skipped,
				txSent,
				systemicFailure: "submission_failed_non_revert",
				uploadsAttempted,
				uploadsSucceeded,
				uploadsFailed,
				orphanedCids: orphanedCids.length > 0 ? orphanedCids : undefined,
			};
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

			// Success — remove CID from orphanedCids (it was successfully submitted on-chain)
			if (prep.status === "ready") {
				const cidIndex = orphanedCids.indexOf(prep.cid);
				if (cidIndex !== -1) orphanedCids.splice(cidIndex, 1);
			}

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
				return {
					skipped,
					txSent,
					systemicFailure: "receipt_timeout",
					uploadsAttempted,
					uploadsSucceeded,
					uploadsFailed,
					orphanedCids: orphanedCids.length > 0 ? orphanedCids : undefined,
				};
			}
			// Unknown receipt error: systemic stop
			log.error(
				{ txHash: hash, action: action.type, agentId: agentIdStr, reason: "receipt_null" },
				"Null or unexpected receipt error",
			);
			return {
				skipped,
				txSent,
				systemicFailure: "receipt_null",
				uploadsAttempted,
				uploadsSucceeded,
				uploadsFailed,
				orphanedCids: orphanedCids.length > 0 ? orphanedCids : undefined,
			};
		}
	}

	return {
		skipped,
		txSent,
		uploadsAttempted,
		uploadsSucceeded,
		uploadsFailed,
		orphanedCids: orphanedCids.length > 0 ? orphanedCids : undefined,
	};
}
