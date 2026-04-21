import { describe, expect, it } from "vitest";
import { buildFeedbackURI, buildNegativeEvidence, buildPositiveEvidence } from "../src/evidence.js";
import type { EvidenceJson } from "../src/types.js";

const baseParams = {
	agentId: 42n,
	pgtcrItemId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
	pgtcrAddress: "0x3162df9669affa8b6b6ff2147afa052249f00447",
	routerAddress: "0xRouterAddress1234567890abcdef12345678",
	chainId: 11155111,
	stake: "2000000000000000",
};

describe("buildFeedbackURI", () => {
	it("produces data:application/json;base64,... string", () => {
		const evidence: EvidenceJson = {
			schema: "kleros-reputation-oracle/v1",
			agentRegistry: "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e",
			agentId: "42",
			clientAddress: "eip155:11155111:0xRouter",
			createdAt: "2026-03-26T00:00:00.000Z",
			value: 95,
			valueDecimals: 0,
			tag1: "verified",
			tag2: "kleros-agent-registry",
			kleros: {
				pgtcrAddress: "0x3162df9669affa8b6b6ff2147afa052249f00447",
				pgtcrItemId: "0xitem",
				stakeAmount: "0.002",
				stakeToken: "WETH",
				disputeId: null,
				ruling: null,
			},
		};

		const uri = buildFeedbackURI(evidence);
		expect(uri).toMatch(/^data:application\/json;base64,/);
	});

	it("base64-decodes to valid JSON matching the input", () => {
		const evidence: EvidenceJson = {
			schema: "kleros-reputation-oracle/v1",
			agentRegistry: "eip155:11155111:0x8004A818BFB912233c491871b3d84c89A494BD9e",
			agentId: "42",
			clientAddress: "eip155:11155111:0xRouter",
			createdAt: "2026-03-26T00:00:00.000Z",
			value: 95,
			valueDecimals: 0,
			tag1: "verified",
			tag2: "kleros-agent-registry",
			kleros: {
				pgtcrAddress: "0x3162",
				pgtcrItemId: "0xitem",
				stakeAmount: "0.002",
				stakeToken: "WETH",
				disputeId: null,
				ruling: null,
			},
		};

		const uri = buildFeedbackURI(evidence);
		const base64 = uri.replace("data:application/json;base64,", "");
		const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
		expect(decoded.schema).toBe("kleros-reputation-oracle/v1");
		expect(decoded.agentId).toBe("42");
		expect(decoded.tag1).toBe("verified");
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
