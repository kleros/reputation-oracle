import { createChildLogger } from "./logger.js";
import type { RawSubgraphItem, ValidatedItem } from "./types.js";

const log = createChildLogger("validation");

const ACTIONABLE_STATUSES = ["Submitted", "Reincluded", "Absent"] as const;
type ActionableStatus = (typeof ACTIONABLE_STATUSES)[number];

/**
 * Parse chain ID from a CAIP-10 identifier.
 * Expected format: "eip155:<chainId>:<address>"
 * Returns null on any parsing failure.
 */
export function parseChainIdFromCAIP10(caip10: string): number | null {
	const parts = caip10.split(":");
	if (parts.length < 2 || parts[0] !== "eip155") {
		return null;
	}
	const chainId = Number.parseInt(parts[1], 10);
	return Number.isNaN(chainId) ? null : chainId;
}

/**
 * Validate and transform a raw subgraph item into a ValidatedItem.
 * Returns null (with structured log.warn) for invalid items.
 *
 * Validation:
 * - metadata must exist with key0 (numeric) and key2 (CAIP-10)
 * - CAIP-10 chain must match targetChainId
 * - status must be Submitted, Reincluded, or Absent (Disputed and unknown skipped)
 * - agentId parsed as BigInt (never Number)
 */
export function validateAndTransformItem(raw: RawSubgraphItem, targetChainId: number): ValidatedItem | null {
	// 1. Metadata must exist
	if (!raw.metadata) {
		log.warn({ itemId: raw.id, reason: "no metadata" }, "Skipping item");
		return null;
	}

	// 2. Validate key2 (CAIP-10 chain)
	const key2 = raw.metadata.key2?.trim();
	if (!key2) {
		log.warn({ itemId: raw.id, reason: "missing metadata.key2" }, "Skipping item");
		return null;
	}
	const chainId = parseChainIdFromCAIP10(key2);
	if (chainId === null) {
		log.warn({ itemId: raw.id, reason: "invalid CAIP-10 format", key2 }, "Skipping item");
		return null;
	}
	if (chainId !== targetChainId) {
		log.warn({ itemId: raw.id, reason: "chain mismatch", chainId, targetChainId }, "Skipping item");
		return null;
	}

	// 3. Validate key0 (agentId -- must be numeric string)
	const key0 = raw.metadata.key0?.trim();
	if (!key0 || !/^\d+$/.test(key0)) {
		log.warn({ itemId: raw.id, reason: "invalid key0", key0 }, "Skipping item");
		return null;
	}

	// 4. Parse agentId as bigint (not Number -- avoids overflow)
	let agentId: bigint;
	try {
		agentId = BigInt(key0);
	} catch {
		log.warn({ itemId: raw.id, reason: "key0 not parseable as bigint", key0 }, "Skipping item");
		return null;
	}

	// 5. Validate status -- only actionable statuses pass through
	if (!ACTIONABLE_STATUSES.includes(raw.status as ActionableStatus)) {
		log.warn({ itemId: raw.id, reason: "non-actionable status", status: raw.status }, "Skipping item");
		return null;
	}

	// 6. Extract latest dispute outcome
	const latestChallenge = raw.challenges?.[0];
	const latestDisputeOutcome = (latestChallenge?.disputeOutcome as ValidatedItem["latestDisputeOutcome"]) ?? null;
	const disputeId = latestChallenge?.disputeID ?? null;

	return {
		agentId,
		itemID: raw.itemID,
		status: raw.status as ValidatedItem["status"],
		latestDisputeOutcome,
		pgtcrItemId: raw.itemID,
		stake: raw.stake,
		disputeId,
	};
}
