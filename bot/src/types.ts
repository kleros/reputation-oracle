// FeedbackType mirrors Router's Solidity enum
export enum FeedbackType {
	None = 0,
	Positive = 1,
	Negative = 2,
}

// Raw item from subgraph GraphQL response
export interface RawSubgraphItem {
	id: string; // entity ID: "<itemID>@<tcrAddress>"
	itemID: string; // bytes32 keccak hash
	status: string; // "Submitted" | "Reincluded" | "Absent" | "Disputed" | ...
	metadata: {
		key0: string | null; // agentId (numeric string)
		key2: string | null; // CAIP-10 chain identifier
	} | null;
	challenges: Array<{
		disputeOutcome: string | null;
		disputeID: string | null;
		resolutionTime: string | null;
	}>;
	stake: string | null;
}

// Validated and transformed item ready for diff
export interface ValidatedItem {
	agentId: bigint;
	itemID: string; // bytes32 hex
	status: "Submitted" | "Reincluded" | "Absent";
	latestDisputeOutcome: "None" | "Accept" | "Reject" | null;
	pgtcrItemId: string; // same as itemID, kept for evidence
	stake: string | null;
	disputeId: string | null;
}

// Action types the diff engine produces
export type Action =
	| { type: "submitPositiveFeedback"; agentId: bigint; pgtcrItemId: string; item: ValidatedItem }
	| { type: "submitNegativeFeedback"; agentId: bigint; item: ValidatedItem }
	| { type: "revokeOnly"; agentId: bigint; item: ValidatedItem };

// Evidence JSON schema for kleros-reputation-oracle/v1
export interface EvidenceJson {
	schema: "kleros-reputation-oracle/v1";
	agentRegistry: string;
	agentId: string; // decimal string — lossless for uint256 agent IDs above Number.MAX_SAFE_INTEGER
	clientAddress: string;
	createdAt: string;
	value: number;
	valueDecimals: number;
	tag1: string;
	tag2: string;
	kleros: {
		pgtcrAddress: string;
		pgtcrItemId: string;
		stakeAmount: string;
		stakeToken: string;
		disputeId: number | null;
		ruling: number | null;
	};
}

/** Run summary emitted as the final log line before exit (D-05, extended by D-20). */
export interface RunSummary {
	itemsFetched: number; // D-25: renamed from items for dashboard query readability (OBS-08)
	valid: number;
	actions: number;
	txSent: number; // counts only confirmed non-reverted receipts (semantic change from Phase 4)
	errors: number;
	durationMs: number;
	skipped: number; // count of item-specific skips during this run (D-20)
	systemicFailure?: string; // reason from D-19 taxonomy; absent on success (D-20)
	uploadsAttempted?: number; // absent when PINATA_JWT not configured (D-33)
	uploadsSucceeded?: number;
	uploadsFailed?: number;
	orphanedCids?: string[]; // CIDs uploaded but not submitted due to shutdown or systemic failure (D-24)
}

/** Return type of executeActions() — replaces Promise<void> (D-20). */
export interface ExecuteActionsResult {
	skipped: number;
	txSent: number;
	systemicFailure?: string; // reason code from D-19 taxonomy; absent on success
	orphanedCids?: string[]; // CIDs uploaded but not submitted due to shutdown or systemic failure (D-24)
	uploadsAttempted?: number; // absent when PINATA_JWT not configured (D-33)
	uploadsSucceeded?: number;
	uploadsFailed?: number;
}

/** Mutable object threaded from index.ts into executeActions() to propagate SIGTERM/SIGINT (D-05). */
export interface ShutdownHolder {
	shutdown: boolean;
}
