import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		unstubGlobals: true, // auto-restore any globals stubbed via vi.stubGlobal after each test
		unstubEnvs: true, // same for process.env stubs — future-proofs integration test that stubs PINATA_JWT
	},
});
