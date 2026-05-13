import { createChildLogger } from "./logger.js";
import { type Action, FeedbackType, type ValidatedItem } from "./types.js";

const log = createChildLogger("diff");

/**
 * Pure stateless diff engine: maps (subgraph state, router state) -> action list.
 *
 * Groups items by agentId, emits at most one action per agentId per run:
 * - Any live item (Submitted | Reincluded) → Scenario 1: submitPositiveFeedback
 *   iff currentType ∈ {None, Negative}. Absent items in the same group are ignored.
 * - No live item, ≥1 Absent with Reject → Scenario 2: submitNegativeFeedback
 *   iff currentType == Positive.
 * - No live item, all Absent have outcome ∈ {null, "None", "Accept"} → Scenario 3:
 *   revokeOnly iff currentType == Positive.
 *
 * No I/O, no async, no side effects (warn log is the sole observable side effect).
 */
export function computeActions(items: ValidatedItem[], routerStates: Map<bigint, FeedbackType>): Action[] {
	// Group all items by agentId
	const byAgentId = new Map<bigint, ValidatedItem[]>();
	for (const item of items) {
		const group = byAgentId.get(item.agentId);
		if (group) {
			group.push(item);
		} else {
			byAgentId.set(item.agentId, [item]);
		}
	}

	const actions: Action[] = [];

	for (const [agentId, group] of byAgentId) {
		const currentType = routerStates.get(agentId) ?? FeedbackType.None;

		// Partition into live and absent items
		const liveItems = group.filter((i) => i.status === "Submitted" || i.status === "Reincluded");
		const absentItems = group.filter((i) => i.status === "Absent");

		if (liveItems.length > 0) {
			// Scenario 1: live item(s) present — emit submitPositiveFeedback iff not already Positive

			// Multiple live items for one agentId — deterministic tiebreak: largest itemID.
			// Expected to be rare; lexicographic sort is stable and easy to explain.
			const liveItem =
				liveItems.length === 1
					? liveItems[0]
					: liveItems.reduce((best, cur) => (cur.itemID > best.itemID ? cur : best));

			// Race-detector: if a Reject-Absent also exists for this agentId, the -95
			// is intentionally skipped because the live re-registration takes precedence.
			const rejectedAbsent = absentItems.find((i) => i.latestDisputeOutcome === "Reject");
			if (rejectedAbsent) {
				log.warn(
					{
						agentId: agentId.toString(),
						liveItemId: liveItem.itemID,
						rejectedItemId: rejectedAbsent.itemID,
					},
					"reject+resubmit race detected, -95 not posted",
				);
			}

			if (currentType !== FeedbackType.Positive) {
				actions.push({
					type: "submitPositiveFeedback",
					agentId,
					pgtcrItemId: liveItem.pgtcrItemId,
					item: liveItem,
				});
			}
		} else {
			// No live items — decide based on Absent items only
			const hasReject = absentItems.some((i) => i.latestDisputeOutcome === "Reject");

			if (hasReject) {
				// Scenario 2: dispute-rejected removal — emit submitNegativeFeedback iff currently Positive
				if (currentType === FeedbackType.Positive) {
					// biome-ignore lint/style/noNonNullAssertion: hasReject guarantees at least one Reject item exists
					const rejectedItem = absentItems.find((i) => i.latestDisputeOutcome === "Reject")!;
					actions.push({
						type: "submitNegativeFeedback",
						agentId,
						item: rejectedItem,
					});
				}
			} else {
				// Scenario 3: voluntary withdrawal (or no challenge / RTA)
				// disputeOutcome null = no challenge; "None" = RTA / no ruling (NOT same as challenger
				// lost); "Accept" = challenger lost (item should have stayed). All three are voluntary-
				// withdrawal equivalents from the bot's perspective: revoke positive feedback.
				if (currentType === FeedbackType.Positive) {
					const absentItem = absentItems[0] ?? group[0];
					actions.push({
						type: "revokeOnly",
						agentId,
						item: absentItem,
					});
				}
			}
		}
	}

	return actions;
}
