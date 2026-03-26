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
	agentId: number;
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
