import type { EvidenceJson } from "./types.js";

const AGENT_REGISTRY_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

interface EvidenceParams {
	agentId: bigint;
	pgtcrItemId: string;
	pgtcrAddress: string;
	routerAddress: string;
	chainId: number;
	stake: string | null;
}

interface NegativeEvidenceParams extends EvidenceParams {
	disputeId: string | null;
}

/**
 * Build positive feedback evidence (Scenario 1: verified on PGTCR).
 * tag1 = "verified", value = 95
 */
export function buildPositiveEvidence(params: EvidenceParams): EvidenceJson {
	return {
		schema: "kleros-reputation-oracle/v1",
		agentRegistry: `eip155:${params.chainId}:${AGENT_REGISTRY_ADDRESS}`,
		agentId: params.agentId.toString(),
		clientAddress: `eip155:${params.chainId}:${params.routerAddress}`,
		createdAt: new Date().toISOString(),
		value: 95,
		valueDecimals: 0,
		tag1: "verified",
		tag2: "kleros-agent-registry",
		kleros: {
			pgtcrAddress: params.pgtcrAddress,
			pgtcrItemId: params.pgtcrItemId,
			stakeAmount: formatStake(params.stake),
			stakeToken: "WETH",
			disputeId: null,
			ruling: null,
		},
	};
}

/**
 * Build negative feedback evidence (Scenario 2: removed by dispute).
 * tag1 = "removed", value = -95
 */
export function buildNegativeEvidence(params: NegativeEvidenceParams): EvidenceJson {
	const disputeIdNum = params.disputeId ? Number.parseInt(params.disputeId, 10) : null;
	return {
		schema: "kleros-reputation-oracle/v1",
		agentRegistry: `eip155:${params.chainId}:${AGENT_REGISTRY_ADDRESS}`,
		agentId: params.agentId.toString(),
		clientAddress: `eip155:${params.chainId}:${params.routerAddress}`,
		createdAt: new Date().toISOString(),
		value: -95,
		valueDecimals: 0,
		tag1: "removed",
		tag2: "kleros-agent-registry",
		kleros: {
			pgtcrAddress: params.pgtcrAddress,
			pgtcrItemId: params.pgtcrItemId,
			stakeAmount: formatStake(params.stake),
			stakeToken: "WETH",
			disputeId: disputeIdNum,
			ruling: disputeIdNum !== null ? 2 : null,
		},
	};
}

/**
 * Build an ipfs:// URI from a Pinata CID.
 * The CID comes from uploadEvidenceToIPFS() in ipfs.ts.
 * D-03: feedbackURI written to chain is ipfs://<CID>; Kleros CDN URL used in logs only.
 */
export function buildFeedbackURI(cid: string): string {
	return `ipfs://${cid}`;
}

/**
 * Format stake from wei string to human-readable ETH.
 * Returns "0" if stake is null/empty.
 * Uses bigint arithmetic to avoid precision loss for stakes > 9.007 ETH (IN-01).
 */
function formatStake(stake: string | null): string {
	if (!stake) return "0";
	const wei = BigInt(stake);
	const eth = wei / 10n ** 18n;
	const rem = wei % 10n ** 18n;
	if (rem === 0n) return eth.toString();
	return `${eth}.${rem.toString().padStart(18, "0").replace(/0+$/, "")}`;
}
