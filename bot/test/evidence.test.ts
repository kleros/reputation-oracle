import { describe, expect, it } from "vitest";
import { buildFeedbackURI, buildNegativeEvidence, buildPositiveEvidence } from "../src/evidence.js";

const baseParams = {
	agentId: 42n,
	pgtcrItemId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
	pgtcrAddress: "0x3162df9669affa8b6b6ff2147afa052249f00447",
	routerAddress: "0xRouterAddress1234567890abcdef12345678",
	chainId: 11155111,
	stake: "2000000000000000",
};

describe("buildFeedbackURI", () => {
	it("returns ipfs:// URI for a given CID", () => {
		const uri = buildFeedbackURI("QmTestCID123");
		expect(uri).toBe("ipfs://QmTestCID123");
	});

	it("returns ipfs:// URI with Qm-prefixed CID", () => {
		const cid = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
		const uri = buildFeedbackURI(cid);
		expect(uri).toMatch(/^ipfs:\/\/Qm/);
		expect(uri).toBe(`ipfs://${cid}`);
	});
});

describe("buildPositiveEvidence", () => {
	it("creates evidence with value=95 and tag1=verified", () => {
		const evidence = buildPositiveEvidence(baseParams);
		expect(evidence.value).toBe(95);
		expect(evidence.tag1).toBe("verified");
		expect(evidence.tag2).toBe("kleros-agent-registry");
		expect(evidence.schema).toBe("kleros-reputation-oracle/v1");
		expect(evidence.kleros.disputeId).toBeNull();
		expect(evidence.kleros.ruling).toBeNull();
	});

	it("includes human-readable text field", () => {
		const evidence = buildPositiveEvidence(baseParams);
		expect(evidence.text).toBe(
			"Agent 42 is actively collateralized in the Kleros Verified Agents Registry (0x3162df9669affa8b6b6ff2147afa052249f00447) with 0.002 WETH staked. No active disputes.",
		);
	});
});

describe("buildNegativeEvidence", () => {
	it("creates evidence with value=-95 and tag1=removed", () => {
		const evidence = buildNegativeEvidence({
			...baseParams,
			disputeId: "1234",
		});
		expect(evidence.value).toBe(-95);
		expect(evidence.tag1).toBe("removed");
		expect(evidence.tag2).toBe("kleros-agent-registry");
		expect(evidence.kleros.disputeId).toBe(1234);
		expect(evidence.kleros.ruling).toBe(2);
	});

	it("includes human-readable text field with dispute info", () => {
		const evidence = buildNegativeEvidence({
			...baseParams,
			disputeId: "1234",
		});
		expect(evidence.text).toBe(
			"Agent 42 was removed from the Kleros Verified Agents Registry (0x3162df9669affa8b6b6ff2147afa052249f00447) after Kleros dispute #1234. Challenger prevailed.",
		);
	});

	it("uses short form when disputeId is null", () => {
		const evidence = buildNegativeEvidence({ ...baseParams, disputeId: null });
		expect(evidence.text).toBe(
			"Agent 42 was removed from the Kleros Verified Agents Registry (0x3162df9669affa8b6b6ff2147afa052249f00447).",
		);
	});
});

describe("formatStake precision (IN-01)", () => {
	it("formats small stake (0.002 ETH) without precision loss", () => {
		const evidence = buildPositiveEvidence({ ...baseParams, stake: "2000000000000000" });
		expect(evidence.kleros.stakeAmount).toBe("0.002");
	});

	it("formats large stake exactly: 100 ETH (> Number.MAX_SAFE_INTEGER wei)", () => {
		// 100 ETH = 100_000_000_000_000_000_000 wei (20 digits — beyond Number.MAX_SAFE_INTEGER)
		const evidence = buildPositiveEvidence({ ...baseParams, stake: "100000000000000000000" });
		expect(evidence.kleros.stakeAmount).toBe("100");
	});

	it("formats fractional large stake: 100.5 ETH", () => {
		// 100.5 ETH = 100_500_000_000_000_000_000 wei
		const evidence = buildPositiveEvidence({ ...baseParams, stake: "100500000000000000000" });
		expect(evidence.kleros.stakeAmount).toBe("100.5");
	});

	it("returns '0' for null stake", () => {
		const evidence = buildPositiveEvidence({ ...baseParams, stake: null });
		expect(evidence.kleros.stakeAmount).toBe("0");
	});
});
