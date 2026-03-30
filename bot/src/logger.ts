import pino from "pino";

function sanitizeValue(value: string): string {
	return value.replace(/0x[0-9a-fA-F]{64}/gi, "[REDACTED_KEY]").replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
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
				"privateKey",
				"PINATA_JWT",
				"BOT_PRIVATE_KEY",
				"authorization",
				"Authorization",
			],
		},
	},
	pino.destination(2),
); // fd 2 = stderr

export function createChildLogger(module: string) {
	return logger.child({ module });
}

export function reconfigureLogLevel(level: string): void {
	logger.level = level;
}

export default logger;
