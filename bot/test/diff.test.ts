import { describe, expect, it, vi } from "vitest";
import { computeActions } from "../src/diff.js";
import { FeedbackType, type ValidatedItem } from "../src/types.js";

// vi.hoisted ensures mockWarn is available inside the vi.mock factory,
// which is hoisted to the top of the module before any imports are resolved.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

// Mock the logger module so diff.ts's child logger uses our spy instead of pino.
vi.mock("../src/logger.js", () => ({
	createChildLogger: () => ({ warn: mockWarn }),
	logger: {},
}));

/** Helper to create a ValidatedItem with sensible defaults */
function makeItem(overrides: Partial<ValidatedItem> & { agentId: bigint }): ValidatedItem {
	return {
		itemID: "0xabc123",
		status: "Submitted",
		latestDisputeOutcome: null,
		pgtcrItemId: "0xabc123",
		stake: "100000000000000000",
		disputeId: null,
		...overrides,
	};
}

describe("computeActions", () => {
	// ── Scenario 1: Positive feedback ──

	describe("Scenario 1 — Submitted/Reincluded + None/Negative -> positive", () => {
		it("Submitted + None -> submitPositiveFeedback", () => {
			const items = [makeItem({ agentId: 1n, status: "Submitted" })];
			const routerStates = new Map<bigint, FeedbackType>();

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
			expect(actions[0].agentId).toBe(1n);
		});

		it("Reincluded + None -> submitPositiveFeedback", () => {
			const items = [makeItem({ agentId: 2n, status: "Reincluded" })];
			const routerStates = new Map<bigint, FeedbackType>();

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
		});

		it("Submitted + Negative (re-registration) -> submitPositiveFeedback", () => {
			const items = [makeItem({ agentId: 3n, status: "Submitted" })];
			const routerStates = new Map<bigint, FeedbackType>([[3n, FeedbackType.Negative]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
			expect(actions[0].agentId).toBe(3n);
		});

		it("Submitted + Positive -> NO ACTION (already has positive)", () => {
			const items = [makeItem({ agentId: 4n, status: "Submitted" })];
			const routerStates = new Map<bigint, FeedbackType>([[4n, FeedbackType.Positive]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(0);
		});
	});

	// ── Scenario 2: Negative feedback ──

	describe("Scenario 2 — Absent + Reject + Positive -> negative", () => {
		it("Absent + Reject + Positive -> submitNegativeFeedback", () => {
			const items = [makeItem({ agentId: 5n, status: "Absent", latestDisputeOutcome: "Reject" })];
			const routerStates = new Map<bigint, FeedbackType>([[5n, FeedbackType.Positive]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitNegativeFeedback");
			expect(actions[0].agentId).toBe(5n);
		});

		it("Absent + Reject + None -> NO ACTION (nothing to negate)", () => {
			const items = [makeItem({ agentId: 6n, status: "Absent", latestDisputeOutcome: "Reject" })];
			const routerStates = new Map<bigint, FeedbackType>();

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(0);
		});

		it("Absent + Reject + Negative -> NO ACTION (already negative)", () => {
			const items = [makeItem({ agentId: 7n, status: "Absent", latestDisputeOutcome: "Reject" })];
			const routerStates = new Map<bigint, FeedbackType>([[7n, FeedbackType.Negative]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(0);
		});
	});

	// ── Scenario 3: Revoke only ──

	describe("Scenario 3 — Absent + voluntary withdrawal + Positive -> revoke", () => {
		it("Absent + null dispute + Positive -> revokeOnly", () => {
			const items = [makeItem({ agentId: 8n, status: "Absent", latestDisputeOutcome: null })];
			const routerStates = new Map<bigint, FeedbackType>([[8n, FeedbackType.Positive]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("revokeOnly");
			expect(actions[0].agentId).toBe(8n);
		});

		it('Absent + "None" dispute + Positive -> revokeOnly', () => {
			const items = [makeItem({ agentId: 9n, status: "Absent", latestDisputeOutcome: "None" })];
			const routerStates = new Map<bigint, FeedbackType>([[9n, FeedbackType.Positive]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("revokeOnly");
		});

		it("Absent + Accept dispute + Positive -> revokeOnly", () => {
			const items = [makeItem({ agentId: 10n, status: "Absent", latestDisputeOutcome: "Accept" })];
			const routerStates = new Map<bigint, FeedbackType>([[10n, FeedbackType.Positive]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("revokeOnly");
		});

		it("Absent + no dispute + None -> NO ACTION (nothing to revoke)", () => {
			const items = [makeItem({ agentId: 11n, status: "Absent", latestDisputeOutcome: null })];
			const routerStates = new Map<bigint, FeedbackType>();

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(0);
		});
	});

	// ── Edge cases ──

	describe("Edge cases", () => {
		it("empty items -> empty actions", () => {
			const actions = computeActions([], new Map());
			expect(actions).toHaveLength(0);
		});

		it("multiple items -> correct action per item", () => {
			const items = [
				makeItem({ agentId: 20n, status: "Submitted" }),
				makeItem({ agentId: 21n, status: "Absent", latestDisputeOutcome: "Reject" }),
				makeItem({ agentId: 22n, status: "Absent", latestDisputeOutcome: null }),
			];
			const routerStates = new Map<bigint, FeedbackType>([
				[21n, FeedbackType.Positive],
				[22n, FeedbackType.Positive],
			]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(3);
			expect(actions[0].type).toBe("submitPositiveFeedback");
			expect(actions[1].type).toBe("submitNegativeFeedback");
			expect(actions[2].type).toBe("revokeOnly");
		});

		it("unknown agentId (not in routerStates) -> treated as FeedbackType.None", () => {
			const items = [makeItem({ agentId: 99n, status: "Submitted" })];
			const routerStates = new Map<bigint, FeedbackType>([[1n, FeedbackType.Positive]]);

			const actions = computeActions(items, routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
		});

		it("submitPositiveFeedback includes pgtcrItemId", () => {
			const items = [makeItem({ agentId: 30n, status: "Submitted", itemID: "0xdeadbeef", pgtcrItemId: "0xdeadbeef" })];
			const actions = computeActions(items, new Map());

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
			if (actions[0].type === "submitPositiveFeedback") {
				expect(actions[0].pgtcrItemId).toBe("0xdeadbeef");
			}
		});
	});

	// ── Multi-item per agentId (oscillation regression) ──

	describe("Multi-item per agentId (oscillation regression)", () => {
		// Agent 1436 is the production agent that triggered the oscillation bug.
		// All tests use agentId 1436n with distinct itemIDs to mirror production state.

		it("R-1: Submitted + Absent/None, routerState=None -> 1 submitPositiveFeedback for live item", () => {
			// Post-fix expected steady-state after the timer restarts once.
			const itemA = makeItem({
				agentId: 1436n,
				itemID: "0xitemA",
				pgtcrItemId: "0xitemA",
				status: "Absent",
				latestDisputeOutcome: null,
			});
			const itemB = makeItem({ agentId: 1436n, itemID: "0xitemB", pgtcrItemId: "0xitemB", status: "Submitted" });
			const routerStates = new Map<bigint, FeedbackType>();

			const actions = computeActions([itemB, itemA], routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
			expect(actions[0].agentId).toBe(1436n);
			if (actions[0].type === "submitPositiveFeedback") {
				expect(actions[0].pgtcrItemId).toBe("0xitemB");
			}
		});

		it("R-2: Submitted + Absent/None, routerState=Positive -> 0 actions (steady state)", () => {
			// No action needed on subsequent runs once Router is already Positive.
			const itemA = makeItem({
				agentId: 1436n,
				itemID: "0xitemA",
				pgtcrItemId: "0xitemA",
				status: "Absent",
				latestDisputeOutcome: null,
			});
			const itemB = makeItem({ agentId: 1436n, itemID: "0xitemB", pgtcrItemId: "0xitemB", status: "Submitted" });
			const routerStates = new Map<bigint, FeedbackType>([[1436n, FeedbackType.Positive]]);

			const actions = computeActions([itemB, itemA], routerStates);

			expect(actions).toHaveLength(0);
		});

		it("R-3: Submitted + Absent/Reject, routerState=None -> 1 submitPositiveFeedback + race-detector warn", () => {
			// Live item wins; race-detector warn log must fire; -95 is NOT posted.
			mockWarn.mockClear();
			const itemB = makeItem({ agentId: 1436n, itemID: "0xitemB", pgtcrItemId: "0xitemB", status: "Submitted" });
			const itemC = makeItem({
				agentId: 1436n,
				itemID: "0xitemC",
				pgtcrItemId: "0xitemC",
				status: "Absent",
				latestDisputeOutcome: "Reject",
			});
			const routerStates = new Map<bigint, FeedbackType>();

			const actions = computeActions([itemB, itemC], routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitPositiveFeedback");
			expect(actions[0].agentId).toBe(1436n);
			expect(mockWarn).toHaveBeenCalledWith(
				expect.objectContaining({ agentId: expect.any(String) }),
				"reject+resubmit race detected, -95 not posted",
			);
		});

		it("R-4: Absent/None only, routerState=Positive -> 1 revokeOnly (Scenario 3 preserved)", () => {
			const itemA = makeItem({
				agentId: 1436n,
				itemID: "0xitemA",
				pgtcrItemId: "0xitemA",
				status: "Absent",
				latestDisputeOutcome: null,
			});
			const routerStates = new Map<bigint, FeedbackType>([[1436n, FeedbackType.Positive]]);

			const actions = computeActions([itemA], routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("revokeOnly");
			expect(actions[0].agentId).toBe(1436n);
		});

		it("R-5: Absent/Reject only, routerState=Positive -> 1 submitNegativeFeedback (Scenario 2 preserved)", () => {
			const itemC = makeItem({
				agentId: 1436n,
				itemID: "0xitemC",
				pgtcrItemId: "0xitemC",
				status: "Absent",
				latestDisputeOutcome: "Reject",
			});
			const routerStates = new Map<bigint, FeedbackType>([[1436n, FeedbackType.Positive]]);

			const actions = computeActions([itemC], routerStates);

			expect(actions).toHaveLength(1);
			expect(actions[0].type).toBe("submitNegativeFeedback");
			expect(actions[0].agentId).toBe(1436n);
		});
	});
});
