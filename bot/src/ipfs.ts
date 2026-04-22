import { createChildLogger } from "./logger.js";
import type { EvidenceJson } from "./types.js";

const log = createChildLogger("ipfs");

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const KLEROS_GATEWAY = "https://cdn.kleros.link/ipfs/";
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1000;

type PinataErrorClass = "auth" | "rate-limit" | "server" | "network";

export interface PinataMetadata {
	name: string;
	keyvalues: {
		agentId: string;
		chainId: string;
		pgtcrItemId: string;
		scenario: "verified" | "removed";
	};
}

export interface PinataUploadResult {
	cid: string;
	gatewayUrl: string;
	size: number;
	timestamp: string;
}

function classifyHttpStatus(status: number): PinataErrorClass {
	if (status === 401 || status === 403) return "auth";
	if (status === 429) return "rate-limit";
	if (status >= 500) return "server";
	return "network"; // unexpected 4xx
}

function classifyFetchError(err: unknown): PinataErrorClass {
	if (err instanceof Error) {
		if (err.name === "AbortError") return "network";
		if (err.name === "TypeError") return "network";
	}
	return "network";
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload evidence JSON to Pinata via native fetch.
 * Returns { cid, gatewayUrl, size, timestamp } on success.
 * Throws an Error with an `errorClass` property on failure (after at most one retry for server/rate-limit).
 * D-05, D-06, D-07, D-08, D-14, D-15, D-20, D-21, D-28, D-29, D-31, D-32
 */
export async function uploadEvidenceToIPFS(
	evidence: EvidenceJson,
	metadata: PinataMetadata,
	jwt: string,
	timeoutMs: number,
): Promise<PinataUploadResult> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(PINATA_PIN_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${jwt}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ pinataContent: evidence, pinataMetadata: metadata }),
				signal: controller.signal,
			});
			clearTimeout(timeoutId);

			if (!response.ok) {
				const errorClass = classifyHttpStatus(response.status);
				let errorBody = "(non-JSON body)";
				try {
					const json = (await response.json()) as { error?: string };
					errorBody = (json.error ?? JSON.stringify(json)).slice(0, 500);
				} catch {
					errorBody = (await response.text().catch(() => "(unreadable body)")).slice(0, 500);
				}
				const err = Object.assign(new Error(`Pinata ${response.status}: ${errorBody}`), { errorClass });
				throw err;
			}

			const body = (await response.json()) as {
				IpfsHash: string;
				PinSize: number;
				Timestamp: string;
				isDuplicate?: boolean;
			};

			// isDuplicate=true is still a success — same CID, already pinned (RESEARCH.md §Pitfall 5)
			if (body.isDuplicate) {
				log.debug({ cid: body.IpfsHash }, "Pinata: content already pinned (isDuplicate)");
			}

			const result: PinataUploadResult = {
				cid: body.IpfsHash,
				gatewayUrl: `${KLEROS_GATEWAY}${body.IpfsHash}`,
				size: body.PinSize,
				timestamp: body.Timestamp,
			};

			// D-31: success log with structured fields
			log.info(
				{ cid: result.cid, size: result.size, duration_ms: 0, gateway_url: result.gatewayUrl },
				"ipfs-upload-ok",
			);

			return result;
		} catch (err) {
			clearTimeout(timeoutId);
			lastError = err;
			const errorClass = (err as { errorClass?: PinataErrorClass }).errorClass ?? classifyFetchError(err);

			if (errorClass !== "server" && errorClass !== "rate-limit") {
				throw err; // auth and network: no retry
			}

			if (attempt < MAX_RETRIES) {
				log.debug({ attempt, errorClass }, "Pinata upload failed, retrying");
				await delay(RETRY_DELAY_MS);
			}
		}
	}

	throw lastError;
}
