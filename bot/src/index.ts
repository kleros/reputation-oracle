import { createViemPublicClient, createViemWalletClient, executeActions, readRouterStates } from "./chain.js";
import { loadConfig } from "./config.js";
import { computeActions } from "./diff.js";
import { fetchAllItems } from "./subgraph.js";
import type { ValidatedItem } from "./types.js";
import { validateAndTransformItem } from "./validation.js";

async function main(): Promise<void> {
	// 1. Parse --dry-run flag from process.argv
	const dryRun = process.argv.includes("--dry-run");

	// 2. Load and validate config (exits on failure via zod validation)
	const config = loadConfig();
	console.log(`Kleros Reputation Bot starting (chainId=${config.CHAIN_ID}, dryRun=${dryRun})`);

	// 3. Fetch all PGTCR items from subgraph
	const rawItems = await fetchAllItems(config.SUBGRAPH_URL, config.PGTCR_ADDRESS);
	console.log(`Fetched ${rawItems.length} raw items from subgraph`);

	// 4. Validate and transform items (invalid items logged + skipped by validation.ts)
	const validItems: ValidatedItem[] = rawItems
		.map((item) => validateAndTransformItem(item, config.CHAIN_ID))
		.filter((item): item is ValidatedItem => item !== null);
	console.log(`${validItems.length} valid items (${rawItems.length - validItems.length} skipped)`);

	// 5. Extract unique agentIds for Router state reads
	const agentIds = [...new Set(validItems.map((item) => item.agentId))];

	// 6. Read Router state via Multicall3
	const publicClient = createViemPublicClient(config);
	console.log(`Reading Router state for ${agentIds.length} agents via Multicall3`);
	const routerStates = await readRouterStates(publicClient, config.ROUTER_ADDRESS, agentIds);

	// 7. Compute diff: subgraph state vs Router state -> actions
	const actions = computeActions(validItems, routerStates);
	console.log(`Computed ${actions.length} actions`);

	// 8. Dry-run: print actions as JSON and exit
	if (dryRun) {
		const serializable = actions.map((a) => ({
			...a,
			agentId: a.agentId.toString(),
			item: { ...a.item, agentId: a.item.agentId.toString() },
		}));
		console.log(JSON.stringify(serializable, null, 2));
		console.log(`Dry run complete: ${actions.length} actions would be executed`);
		return;
	}

	// 9. No actions needed
	if (actions.length === 0) {
		console.log("No actions needed. Bot exiting.");
		return;
	}

	// 10. Execute transactions sequentially
	const walletClient = createViemWalletClient(config);
	console.log(`Executing ${actions.length} actions sequentially...`);
	await executeActions(walletClient, publicClient, actions, config);
	console.log(`All ${actions.length} actions executed successfully.`);
}

// Run and handle exit codes
main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("Bot failed:", error instanceof Error ? error.message : error);
		process.exit(1);
	});
