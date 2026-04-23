import { describe, expect, it, vi } from "vitest";
import { configSchema } from "../src/config.js";

const validEnv = {
	CHAIN_ID: "11155111",
	RPC_URL: "https://ethereum-sepolia-rpc.publicnode.com",
	ROUTER_ADDRESS: "0x1234567890abcdef1234567890abcdef12345678",
	PGTCR_ADDRESS: "0x3162df9669affa8b6b6ff2147afa052249f00447",
	SUBGRAPH_URL:
		"https://api.goldsky.com/api/public/project_cmgx9all3003atlp2bqha1zif/subgraphs/pgtcr-sepolia/v0.0.2/gn",
	BOT_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
};

describe("configSchema", () => {
	it("accepts valid environment variables", () => {
		const result = configSchema.safeParse(validEnv);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.CHAIN_ID).toBe(11155111);
			expect(result.data.RPC_URL).toBe(validEnv.RPC_URL);
			expect(result.data.ROUTER_ADDRESS).toBe(validEnv.ROUTER_ADDRESS);
		}
	});

	it("rejects missing CHAIN_ID", () => {
		const { CHAIN_ID, ...rest } = validEnv;
		const result = configSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects invalid RPC_URL (not a URL)", () => {
		const result = configSchema.safeParse({ ...validEnv, RPC_URL: "not-a-url" });
		expect(result.success).toBe(false);
	});

	it("rejects invalid ROUTER_ADDRESS (not hex)", () => {
		const result = configSchema.safeParse({ ...validEnv, ROUTER_ADDRESS: "not-an-address" });
		expect(result.success).toBe(false);
	});

	it("rejects invalid BOT_PRIVATE_KEY (wrong length)", () => {
		const result = configSchema.safeParse({ ...validEnv, BOT_PRIVATE_KEY: "0xshort" });
		expect(result.success).toBe(false);
	});

	it("does not expose BOT_PRIVATE_KEY in error output", () => {
		const _badKey = `0x${"ff".repeat(32)}`;
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Use a bad env but with a valid-looking private key that we want to make sure isn't leaked
		const result = configSchema.safeParse({
			...validEnv,
			BOT_PRIVATE_KEY: "invalid_key_value_that_should_not_appear",
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			// Verify the error issues don't contain the raw key value
			const errorStr = JSON.stringify(result.error.issues);
			expect(errorStr).not.toContain("invalid_key_value_that_should_not_appear");
		}

		consoleSpy.mockRestore();
	});
});

describe("Betterstack config fields", () => {
	it("accepts BETTERSTACK_SOURCE_TOKEN when present", () => {
		const result = configSchema.safeParse({ ...validEnv, BETTERSTACK_SOURCE_TOKEN: "tok" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.BETTERSTACK_SOURCE_TOKEN).toBe("tok");
		}
	});

	it("accepts missing BETTERSTACK_SOURCE_TOKEN (undefined)", () => {
		const result = configSchema.safeParse(validEnv);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.BETTERSTACK_SOURCE_TOKEN).toBeUndefined();
		}
	});

	it("rejects BETTERSTACK_HEARTBEAT_URL when not a valid URL", () => {
		const result = configSchema.safeParse({ ...validEnv, BETTERSTACK_HEARTBEAT_URL: "not-a-url" });
		expect(result.success).toBe(false);
	});

	it("accepts BETTERSTACK_HEARTBEAT_URL when a valid URL", () => {
		const result = configSchema.safeParse({
			...validEnv,
			BETTERSTACK_HEARTBEAT_URL: "https://uptime.betterstack.com/api/v1/heartbeat/abc123",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.BETTERSTACK_HEARTBEAT_URL).toBe(
				"https://uptime.betterstack.com/api/v1/heartbeat/abc123",
			);
		}
	});

	it("defaults HEARTBEAT_TIMEOUT_MS to 10000 when absent", () => {
		const result = configSchema.safeParse(validEnv);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.HEARTBEAT_TIMEOUT_MS).toBe(10000);
		}
	});

	it("coerces HEARTBEAT_TIMEOUT_MS from string to number", () => {
		const result = configSchema.safeParse({ ...validEnv, HEARTBEAT_TIMEOUT_MS: "5000" });
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.HEARTBEAT_TIMEOUT_MS).toBe(5000);
		}
	});

	it("rejects HEARTBEAT_TIMEOUT_MS when not positive (negative value)", () => {
		const result = configSchema.safeParse({ ...validEnv, HEARTBEAT_TIMEOUT_MS: "-1" });
		expect(result.success).toBe(false);
	});
});
