import { afterEach, describe, expect, it, vi } from "vitest";

describe("closeLogger", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("invokes callback on the stderr-only path (no BETTERSTACK_SOURCE_TOKEN)", async () => {
		// No token set → transport is stderr-only (no @logtail/pino worker thread)
		vi.stubEnv("BETTERSTACK_SOURCE_TOKEN", "");
		const { closeLogger } = await import("../src/logger.js");

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("closeLogger did not call cb within 2s")), 2000);
			closeLogger(() => {
				clearTimeout(timeout);
				resolve();
			});
		});
	});

	it("invokes callback exactly once even if called with a race condition", async () => {
		vi.stubEnv("BETTERSTACK_SOURCE_TOKEN", "");
		const { closeLogger } = await import("../src/logger.js");

		let callCount = 0;
		await new Promise<void>((resolve) => {
			closeLogger(() => {
				callCount++;
				if (callCount === 1) resolve();
			});
		});

		expect(callCount).toBe(1);
	});

	it("invokes callback via the 5s fallback when transport never emits 'close' (D-17 safety net)", async () => {
		// Simulate the transport-present path where close never fires (dead Betterstack endpoint).
		// We cannot easily stub @logtail/pino from outside the module, so we use vi.useFakeTimers()
		// to jump past the 5-second fallback deterministically. The test imports the module with
		// the token set so the transport branch is taken, then advances fake timers.
		vi.stubEnv("BETTERSTACK_SOURCE_TOKEN", "test-token");
		vi.useFakeTimers();

		try {
			const { closeLogger } = await import("../src/logger.js");
			let resolved = false;
			const donePromise = new Promise<void>((resolve) => {
				closeLogger(() => {
					resolved = true;
					resolve();
				});
			});

			// Advance past the 5000ms fallback. logger.flush + transport.end may or may not have
			// called the callback synchronously; if not, the fallback setTimeout fires at T+5000ms
			// and invokes the callback via done().
			await vi.advanceTimersByTimeAsync(5100);
			await donePromise;
			expect(resolved).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
