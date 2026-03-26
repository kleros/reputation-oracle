import { describe, expect, it, vi } from "vitest";
import type { RawSubgraphItem } from "../src/types.js";
import { parseChainIdFromCAIP10, validateAndTransformItem } from "../src/validation.js";

describe("parseChainIdFromCAIP10", () => {
	it("parses eip155:11155111:0xabc correctly", () => {
		expect(parseChainIdFromCAIP10("eip155:11155111:0xabc")).toBe(11155111);
	});

	it("parses eip155:1:0xabc correctly", () => {
		expect(parseChainIdFromCAIP10("eip155:1:0xabc")).toBe(1);
	});

	it("returns null for invalid format", () => {
		expect(parseChainIdFromCAIP10("invalid")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseChainIdFromCAIP10("")).toBeNull();
	});

	it("returns null for non-eip155 namespace", () => {
		expect(parseChainIdFromCAIP10("bip122:1:0xabc")).toBeNull();
	});
});

const makeItem = (overrides: Partial<RawSubgraphItem> = {}): RawSubgraphItem => ({
	id: "0xitem123@0xregistry",
	itemID: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
	status: "Submitted",
	metadata: {
		key0: "42",
		key2: "eip155:11155111:0xabc",
	},
	challenges: [],
	stake: "2000000000000000",
	...overrides,
});

describe("validateAndTransformItem", () => {
	const targetChainId = 11155111;

	it("transforms valid item to ValidatedItem with bigint agentId", () => {
		const result = validateAndTransformItem(makeItem(), targetChainId);
		expect(result).not.toBeNull();
		expect(result?.agentId).toBe(42n);
		expect(result?.status).toBe("Submitted");
		expect(result?.itemID).toBe("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
		expect(result?.pgtcrItemId).toBe(result?.itemID);
	});

	it("returns null for missing metadata", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(makeItem({ metadata: null }), targetChainId);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("returns null for missing key0", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(
			makeItem({ metadata: { key0: null, key2: "eip155:11155111:0xabc" } }),
			targetChainId,
		);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("returns null for non-numeric key0", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(
			makeItem({ metadata: { key0: "not-a-number", key2: "eip155:11155111:0xabc" } }),
			targetChainId,
		);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("returns null for wrong chainId", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(
			makeItem({ metadata: { key0: "42", key2: "eip155:1:0xabc" } }),
			targetChainId,
		);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("returns null for bad CAIP-10 format", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(
			makeItem({ metadata: { key0: "42", key2: "invalid-format" } }),
			targetChainId,
		);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("returns null for Disputed status (not actionable)", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(makeItem({ status: "Disputed" }), targetChainId);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("returns null for unknown status", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(makeItem({ status: "Unknown" }), targetChainId);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("extracts disputeOutcome from challenges for Absent items", () => {
		const result = validateAndTransformItem(
			makeItem({
				status: "Absent",
				challenges: [{ disputeOutcome: "Reject", disputeID: "1234", resolutionTime: "1234567890" }],
			}),
			targetChainId,
		);
		expect(result).not.toBeNull();
		expect(result?.latestDisputeOutcome).toBe("Reject");
		expect(result?.disputeId).toBe("1234");
	});

	it("sets latestDisputeOutcome to null for Absent items with no challenges", () => {
		const result = validateAndTransformItem(makeItem({ status: "Absent", challenges: [] }), targetChainId);
		expect(result).not.toBeNull();
		expect(result?.latestDisputeOutcome).toBeNull();
		expect(result?.disputeId).toBeNull();
	});

	it("returns null for missing key2", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = validateAndTransformItem(makeItem({ metadata: { key0: "42", key2: null } }), targetChainId);
		expect(result).toBeNull();
		spy.mockRestore();
	});

	it("handles Reincluded status as valid", () => {
		const result = validateAndTransformItem(makeItem({ status: "Reincluded" }), targetChainId);
		expect(result).not.toBeNull();
		expect(result?.status).toBe("Reincluded");
	});
});
