import {
	type Chain,
	http,
	type PublicClient,
	createPublicClient as viemCreatePublicClient,
	createWalletClient as viemCreateWalletClient,
	type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { routerAbi } from "./abi/router.js";
import type { Config } from "./config.js";
import { buildFeedbackURI, buildNegativeEvidence, buildPositiveEvidence } from "./evidence.js";
import { createChildLogger } from "./logger.js";
import { type Action, FeedbackType } from "./types.js";

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
 * Execute actions sequentially with explicit nonce management.
 * Stops on first failure (D-10).
 */
export async function executeActions(
	walletClient: WalletClient,
	publicClient: PublicClient,
	actions: Action[],
	config: Config,
): Promise<void> {
	if (actions.length === 0) {
		log.info("No actions to execute");
		return;
	}

	const account = walletClient.account;
	if (!account) throw new Error("WalletClient has no account");

	// Fetch nonce once at start (D-09)
	let nonce = await publicClient.getTransactionCount({
		address: account.address,
	});

	for (const action of actions) {
		let hash: `0x${string}`;

		if (action.type === "submitPositiveFeedback") {
			const evidence = buildPositiveEvidence({
				agentId: action.agentId,
				pgtcrItemId: action.pgtcrItemId,
				pgtcrAddress: config.PGTCR_ADDRESS,
				routerAddress: config.ROUTER_ADDRESS,
				chainId: config.CHAIN_ID,
				stake: action.item.stake,
			});
			const feedbackURI = buildFeedbackURI(evidence);

			hash = await walletClient.writeContract({
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "submitPositiveFeedback",
				args: [action.agentId, action.pgtcrItemId as `0x${string}`, feedbackURI],
				nonce,
				chain: walletClient.chain,
				account,
			});
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
			const feedbackURI = buildFeedbackURI(evidence);

			hash = await walletClient.writeContract({
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "submitNegativeFeedback",
				args: [action.agentId, feedbackURI],
				nonce,
				chain: walletClient.chain,
				account,
			});
		} else {
			// revokeOnly
			hash = await walletClient.writeContract({
				address: config.ROUTER_ADDRESS as `0x${string}`,
				abi: routerAbi,
				functionName: "revokeOnly",
				args: [action.agentId],
				nonce,
				chain: walletClient.chain,
				account,
			});
		}

		// Wait for receipt with bounded timeout
		const receipt = await publicClient.waitForTransactionReceipt({
			hash,
			timeout: 60_000,
		});

		// Stop on first failure (D-10)
		if (receipt.status === "reverted") {
			throw new Error(`Transaction reverted: ${hash} for ${action.type} agentId=${action.agentId}`);
		}

		nonce++;
		log.info({ txHash: hash, action: action.type, agentId: action.agentId.toString() }, "TX confirmed");
	}
}
