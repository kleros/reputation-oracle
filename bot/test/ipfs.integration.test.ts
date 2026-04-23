/**
 * Integration test for Pinata IPFS upload/unpin.
 * Skipped unless PINATA_JWT env var is set (D-35).
 * Requires a Pinata JWT with pinJSONToIPFS: true AND unpin: true scopes.
 * Run manually: PINATA_JWT=<jwt> pnpm exec vitest run test/ipfs.integration.test.ts
 */
import { expect, test } from "vitest";

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

test.skipIf(!process.env.PINATA_JWT)(
	"uploads throwaway JSON and unpins via DELETE (real Pinata API)",
	async () => {
		// biome-ignore lint/style/noNonNullAssertion: test.skipIf above guarantees PINATA_JWT is set when this body runs
		const jwt = process.env.PINATA_JWT!;
		const throwawayContent = {
			test: true,
			ts: Date.now(),
			purpose: "kro-integration-test-throwaway",
		};

		// Step 1: Upload
		const uploadRes = await fetch(PINATA_PIN_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				pinataContent: throwawayContent,
				pinataMetadata: { name: "kro-integration-test-throwaway" },
			}),
		});
		expect(uploadRes.ok, `Upload failed with status ${uploadRes.status}`).toBe(true);

		const uploadBody = (await uploadRes.json()) as {
			IpfsHash: string;
			PinSize: number;
			Timestamp: string;
			isDuplicate?: boolean;
		};
		const { IpfsHash } = uploadBody;

		// Assert CID format: CIDv0 starts with Qm (46 chars)
		expect(IpfsHash).toMatch(/^Qm[A-Za-z0-9]{44}$/);

		// Assert gateway URL is constructable
		const gatewayUrl = `https://cdn.kleros.link/ipfs/${IpfsHash}`;
		expect(gatewayUrl).toContain(IpfsHash);

		// Step 2: Unpin (cleanup) — CRITICAL: response is text/plain "OK", NOT JSON (RESEARCH.md §Pitfall 1)
		const unpinRes = await fetch(`https://api.pinata.cloud/pinning/unpin/${IpfsHash}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${jwt}` },
		});
		expect(unpinRes.ok, `Unpin failed with status ${unpinRes.status}`).toBe(true);

		// Use .text() — NOT .json() — unpin response is text/plain "OK"
		const unpinBody = await unpinRes.text();
		expect(unpinBody).toBe("OK");
	},
	30_000, // 30s timeout for real network call
);
