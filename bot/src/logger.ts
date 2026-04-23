import pino from "pino";

// D-11: detect --dry-run at module init so transport construction is conditional
const isDryRun = process.argv.includes("--dry-run");

// D-12: extend sanitizeValue to also redact Betterstack heartbeat URLs
// (URLs contain opaque token: https://uptime.betterstack.com/api/v1/heartbeat/<TOKEN>)
function sanitizeValue(value: string): string {
	return value
		.replace(/0x[0-9a-fA-F]{64}/gi, "[REDACTED_KEY]")
		.replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
		.replace(/https:\/\/uptime\.betterstack\.com\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+/g, "[REDACTED_HEARTBEAT_URL]");
}

function sanitizeObject(obj: unknown): unknown {
	if (typeof obj === "string") return sanitizeValue(obj);
	if (Array.isArray(obj)) return obj.map(sanitizeObject);
	if (obj && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(obj)) {
			result[key] = sanitizeObject(val);
		}
		return result;
	}
	return obj;
}

// D-09: module-level transport reference so closeLogger() can call transport.end()
// Declared before pino() call — pino() will receive transport as its destination arg
let transport: ReturnType<typeof pino.transport> | null = null;

// D-09, D-10: build targets array — stderr always; @logtail/pino only when token set AND not dry-run
const betterstackToken = process.env.BETTERSTACK_SOURCE_TOKEN;
const transportTargets: pino.TransportTargetOptions[] = [
	{ target: "pino/file", options: { destination: 2 } }, // stderr always (D-10)
];

if (betterstackToken && !isDryRun) {
	// D-13: sourceToken + endpoint options
	transportTargets.push({
		target: "@logtail/pino",
		options: {
			sourceToken: betterstackToken,
			options: { endpoint: "https://in.logs.betterstack.com" },
		},
	});
}

transport = pino.transport({ targets: transportTargets });

export const logger = pino(
	{
		level: process.env.LOG_LEVEL ?? "info",
		serializers: {
			err: (err: unknown) => {
				const serialized = pino.stdSerializers.err(err as Error);
				return sanitizeObject(serialized);
			},
		},
		redact: {
			paths: [
				"config.BOT_PRIVATE_KEY",
				"config.PINATA_JWT",
				"config.BETTERSTACK_SOURCE_TOKEN", // D-12
				"config.BETTERSTACK_HEARTBEAT_URL", // D-12
				"privateKey",
				"PINATA_JWT",
				"BOT_PRIVATE_KEY",
				"BETTERSTACK_SOURCE_TOKEN", // D-12
				"BETTERSTACK_HEARTBEAT_URL", // D-12
				"authorization",
				"Authorization",
			],
		},
	},
	transport, // NOTE: pino.destination(2) removed — stderr now in targets[] above (Pitfall 2)
);

export function createChildLogger(module: string) {
	return logger.child({ module });
}

export function reconfigureLogLevel(level: string): void {
	logger.level = level;
}

// D-14, D-15, D-16, D-17: exported for index.ts flushAndExit replacement
// D-16: non-throwing — any internal error during drain is caught and logged to
// console.error as a last-resort escape hatch (logger itself may be mid-drain),
// then cb is invoked regardless.
export function closeLogger(cb: () => void): void {
	let called = false;
	const done = () => {
		if (!called) {
			called = true;
			cb();
		}
	};

	// D-17: 5-second fallback — prevents hung exits on dead Betterstack endpoint.
	const fallback = setTimeout(done, 5000);
	fallback.unref(); // don't keep the event loop alive

	if (!transport) {
		// No worker-thread transport (stderr-only or dry-run) — flush is synchronous-ish
		try {
			logger.flush(() => {
				clearTimeout(fallback);
				done();
			});
		} catch (err) {
			// D-16: last-resort escape hatch — pino itself may be failing; console.error is the only safe channel
			console.error("[closeLogger] stderr flush error:", err);
			clearTimeout(fallback);
			done();
		}
		return;
	}

	// Worker-thread transport path — 3-step drain with try/catch around each failure point
	// Capture transport in a local const so TypeScript narrows the type (avoids ! assertions)
	const t = transport;
	try {
		// Step 1: drain the SharedArrayBuffer IPC queue (all lines received by worker thread)
		logger.flush(() => {
			try {
				// Step 2: signal end-of-stream → triggers worker _destroy → logtail.flush() (HTTP delivery)
				// transport.end() takes no callback (confirmed: transport.end.length === 0 in thread-stream)
				t.end();
				// Step 3: wait for transport close event (or rely on 5s fallback timer — D-17)
				t.on("close", () => {
					clearTimeout(fallback);
					done();
				});
			} catch (err) {
				// D-16: last-resort escape hatch
				console.error("[closeLogger] transport drain error:", err);
				clearTimeout(fallback);
				done();
			}
		});
	} catch (err) {
		// D-16: last-resort escape hatch
		console.error("[closeLogger] flush error:", err);
		clearTimeout(fallback);
		done();
	}
}

export default logger;
