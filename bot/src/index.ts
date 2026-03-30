import { createViemPublicClient, createViemWalletClient, executeActions, readRouterStates } from "./chain.js";
import { loadConfig } from "./config.js";
import { computeActions } from "./diff.js";
import { logger, reconfigureLogLevel } from "./logger.js";
import { fetchAllItems } from "./subgraph.js";
import type { ValidatedItem } from "./types.js";
import { validateAndTransformItem } from "./validation.js";

async function main(): Promise<void> {
	// 1. Parse --dry-run flag from process.argv
	const dryRun = process.argv.includes("--dry-run");

	// 2. Load and validate config (exits on failure via zod validation)
	const config = loadConfig();
	reconfigureLogLevel(config.LOG_LEVEL);
	logger.info({ chainId: config.CHAIN_ID, dryRun }, "Kleros Reputation Bot starting");

	// 3. Fetch all PGTCR items from subgraph
	const rawItems = await fetchAllItems(config.SUBGRAPH_URL, config.PGTCR_ADDRESS);
	logger.info({ count: rawItems.length }, "Fetched raw items from subgraph");

	// 4. Validate and transform items (invalid items logged + skipped by validation.ts)
	const validItems: ValidatedItem[] = rawItems
		.map((item) => validateAndTransformItem(item, config.CHAIN_ID))
		.filter((item): item is ValidatedItem => item !== null);
	logger.info({ valid: validItems.length, skipped: rawItems.length - validItems.length }, "Items validated");

	// 5. Extract unique agentIds for Router state reads
	const agentIds = [...new Set(validItems.map((item) => item.agentId))];

	// 6. Read Router state via Multicall3
	const publicClient = createViemPublicClient(config);
	logger.info({ agentCount: agentIds.length }, "Reading Router state via Multicall3");
	const routerStates = await readRouterStates(publicClient, config.ROUTER_ADDRESS, agentIds);

	// 7. Compute diff: subgraph state vs Router state -> actions
	const actions = computeActions(validItems, routerStates);
	logger.info({ count: actions.length }, "Actions computed");

	// 8. Dry-run: print actions as JSON and exit
	if (dryRun) {
		const serializable = actions.map((a) => ({
			...a,
			agentId: a.agentId.toString(),
			item: { ...a.item, agentId: a.item.agentId.toString() },
		}));
		process.stdout.write(JSON.stringify(serializable, null, 2) + "\n");
		logger.info({ count: actions.length }, "Dry run complete");
		return;
	}

	// 9. No actions needed
	if (actions.length === 0) {
		logger.info("No actions needed, bot exiting");
		return;
	}

	// 10. Execute transactions sequentially
	const walletClient = createViemWalletClient(config);
	logger.info({ count: actions.length }, "Executing actions sequentially");
	await executeActions(walletClient, publicClient, actions, config);
	logger.info({ count: actions.length }, "All actions executed successfully");
}

// Run and handle exit codes
main()
	.then(() => process.exit(0))
	.catch((error) => {
		logger.error({ err: error }, "Bot failed");
		process.exit(1);
	});
