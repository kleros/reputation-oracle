import { createViemPublicClient, createViemWalletClient, executeActions, readRouterStates } from "./chain.js";
import { loadConfig } from "./config.js";
import { computeActions } from "./diff.js";
import { logger, reconfigureLogLevel } from "./logger.js";
import { fetchAllItems } from "./subgraph.js";
import type { ExecuteActionsResult, RunSummary, ShutdownHolder, ValidatedItem } from "./types.js";
import { validateAndTransformItem } from "./validation.js";

function emitSummary(summary: RunSummary, startTime: number): void {
	summary.durationMs = Date.now() - startTime;
	logger.info({ summary }, "Run complete");
}

function flushAndExit(code: number): void {
	logger.flush(() => process.exit(code));
}

async function main(): Promise<void> {
	const startTime = Date.now();
	const summary: RunSummary = { items: 0, valid: 0, actions: 0, txSent: 0, errors: 0, durationMs: 0, skipped: 0 };

	// Register graceful shutdown handlers before any async work (D-03, D-05)
	const shutdownHolder: ShutdownHolder = { shutdown: false };
	const handleSignal = (signal: string): void => {
		logger.warn({ signal }, "Signal received, finishing current action then exiting");
		shutdownHolder.shutdown = true;
	};
	process.on("SIGTERM", () => handleSignal("SIGTERM"));
	process.on("SIGINT", () => handleSignal("SIGINT"));

	try {
		// 1. Parse --dry-run flag from process.argv
		const dryRun = process.argv.includes("--dry-run");

		// 2. Load and validate config (exits on failure via zod validation)
		const config = loadConfig();
		reconfigureLogLevel(config.LOG_LEVEL);
		logger.info({ chainId: config.CHAIN_ID, dryRun }, "Kleros Reputation Bot starting");

		// 3. Fetch all PGTCR items from subgraph
		const rawItems = await fetchAllItems(config.SUBGRAPH_URL, config.PGTCR_ADDRESS);
		logger.info({ count: rawItems.length }, "Fetched raw items from subgraph");
		summary.items = rawItems.length;

		// 4. Validate and transform items (invalid items logged + skipped by validation.ts)
		const validItems: ValidatedItem[] = rawItems
			.map((item) => validateAndTransformItem(item, config.CHAIN_ID))
			.filter((item): item is ValidatedItem => item !== null);
		logger.info({ valid: validItems.length, skipped: rawItems.length - validItems.length }, "Items validated");
		summary.valid = validItems.length;

		// 5. Extract unique agentIds for Router state reads
		const agentIds = [...new Set(validItems.map((item) => item.agentId))];

		// 6. Read Router state via Multicall3
		const publicClient = createViemPublicClient(config);
		// Create walletClient early so we can read account.address without a second
		// privateKeyToAccount() derivation in the balance preflight below (IN-02).
		const walletClient = createViemWalletClient(config);
		logger.info({ agentCount: agentIds.length }, "Reading Router state via Multicall3");
		const routerStates = await readRouterStates(publicClient, config.ROUTER_ADDRESS, agentIds);

		// Balance preflight — must happen before any transactions (D-06)
		const balance = await publicClient.getBalance({ address: walletClient.account!.address });
		if (balance < config.MIN_BALANCE_WEI) {
			logger.error(
				{
					actual: balance.toString(),
					required: config.MIN_BALANCE_WEI.toString(),
					reason: "balance_below_threshold",
				},
				"Insufficient wallet balance, aborting",
			);
			summary.errors = 1;
			summary.systemicFailure = "balance_below_threshold";
			emitSummary(summary, startTime);
			flushAndExit(1);
			return; // unreachable after flushAndExit, but required for TypeScript
		}

		// 7. Compute diff: subgraph state vs Router state -> actions
		const actions = computeActions(validItems, routerStates);
		logger.info({ count: actions.length }, "Actions computed");
		summary.actions = actions.length;

		// 8. Dry-run: print actions as JSON and exit
		if (dryRun) {
			const serializable = actions.map((a) => ({
				...a,
				agentId: a.agentId.toString(),
				item: { ...a.item, agentId: a.item.agentId.toString() },
			}));
			process.stdout.write(JSON.stringify(serializable, null, 2) + "\n");
			logger.info({ count: actions.length }, "Dry run complete");
			emitSummary(summary, startTime);
			flushAndExit(0);
			return; // unreachable
		}

		// 9. No actions needed
		if (actions.length === 0) {
			logger.info("No actions needed, bot exiting");
			emitSummary(summary, startTime);
			flushAndExit(0);
			return; // unreachable
		}

		// 10. Execute transactions sequentially
		logger.info({ count: actions.length }, "Executing actions sequentially");
		const result: ExecuteActionsResult = await executeActions(
			walletClient,
			publicClient,
			actions,
			config,
			shutdownHolder,
		);
		summary.txSent = result.txSent;
		summary.skipped = result.skipped;
		if (result.systemicFailure) {
			summary.errors = 1;
			summary.systemicFailure = result.systemicFailure;
		}

		if (!result.systemicFailure) {
			logger.info({ txSent: result.txSent, skipped: result.skipped }, "Actions executed");
		}

		emitSummary(summary, startTime);
		// Choose exit code: exit 1 if systemicFailure, exit 0 otherwise (D-16/D-17)
		flushAndExit(summary.systemicFailure ? 1 : 0);
		return; // unreachable
	} catch (error) {
		summary.errors = 1;
		emitSummary(summary, startTime);
		logger.error({ err: error }, "Bot failed");
		flushAndExit(1);
		return; // unreachable
	}
}

// Run and handle exit codes
main()
	.then(() => {
		// main() calls flushAndExit() on all paths; this .then() is only reached on unhandled return
		// (defensive — should not occur after the changes above)
	})
	.catch((error) => {
		logger.error({ err: error }, "Bot failed");
		flushAndExit(1);
	});
