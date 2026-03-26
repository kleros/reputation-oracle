import { FeedbackType, type Action, type ValidatedItem } from "./types.js";

/**
 * Pure stateless diff engine: maps (subgraph state, router state) -> action list.
 *
 * For each validated item, determines the required action based on:
 * - Item status (Submitted/Reincluded/Absent)
 * - Current feedback state in Router (None/Positive/Negative)
 * - Dispute outcome (for Absent items)
 *
 * No I/O, no async, no side effects.
 */
export function computeActions(items: ValidatedItem[], routerStates: Map<bigint, FeedbackType>): Action[] {
	const actions: Action[] = [];

	for (const item of items) {
		const currentType = routerStates.get(item.agentId) ?? FeedbackType.None;

		if (item.status === "Submitted" || item.status === "Reincluded") {
			// Scenario 1: Positive feedback for registered items
			// Only if no existing positive feedback (None or Negative from prior dispute)
			if (currentType === FeedbackType.None || currentType === FeedbackType.Negative) {
				actions.push({
					type: "submitPositiveFeedback",
					agentId: item.agentId,
					pgtcrItemId: item.pgtcrItemId,
					item,
				});
			}
			// If already Positive -> no action needed
		} else if (item.status === "Absent") {
			if (item.latestDisputeOutcome === "Reject") {
				// Scenario 2: Negative feedback for dispute-rejected items
				// Only if currently has positive feedback
				if (currentType === FeedbackType.Positive) {
					actions.push({
						type: "submitNegativeFeedback",
						agentId: item.agentId,
						item,
					});
				}
			} else {
				// Scenario 3: Revoke only for voluntary withdrawal
				// disputeOutcome is null, "None", or "Accept" (challenger lost)
				if (currentType === FeedbackType.Positive) {
					actions.push({
						type: "revokeOnly",
						agentId: item.agentId,
						item,
					});
				}
			}
		}
	}

	return actions;
}
