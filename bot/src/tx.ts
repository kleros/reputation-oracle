import {
	type EstimateContractGasParameters,
	type PublicClient,
	BaseError,
	ContractFunctionRevertedError,
	HttpRequestError,
	TimeoutError,
} from "viem";
import { createChildLogger } from "./logger.js";

const log = createChildLogger("tx");

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

/**
 * Retry gas estimation up to MAX_ATTEMPTS times with exponential backoff.
 * Revert errors are NOT retried (immediately throws for caller to skip the action).
 * Transient errors (HttpRequestError, TimeoutError) are retried.
 * After retries exhausted, throws the last error (caller logs + skips the action).
 * NEVER submits a transaction — estimateContractGas is a read-only RPC call.
 */
export async function estimateGasWithRetry(
	publicClient: PublicClient,
	params: EstimateContractGasParameters,
): Promise<bigint> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await publicClient.estimateContractGas(params);
		} catch (err) {
			lastError = err;
			if (isRevertError(err)) {
				throw err; // immediate — no retry for reverts
			}
			if (attempt < MAX_ATTEMPTS) {
				// delays: 1000ms before attempt 2, 2000ms before attempt 3
				log.debug({ attempt, delayMs: BASE_DELAY_MS * 2 ** (attempt - 1) }, "Gas estimation failed, retrying");
				await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
			}
		}
	}
	throw lastError; // exhausted — caller classifies and skips
}

/**
 * Returns true if the error chain contains a ContractFunctionRevertedError.
 * Uses .walk() because estimateContractGas wraps the revert inside ContractFunctionExecutionError.
 */
export function isRevertError(err: unknown): boolean {
	if (!(err instanceof BaseError)) return false;
	return (
		err.walk((e) => e instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError
	);
}

/**
 * Returns true if the error chain contains an HttpRequestError or TimeoutError (transient, retryable).
 */
export function isTransientError(err: unknown): boolean {
	if (!(err instanceof BaseError)) return false;
	const inner = err.walk(
		(e) => e instanceof HttpRequestError || e instanceof TimeoutError,
	);
	return inner instanceof HttpRequestError || inner instanceof TimeoutError;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
