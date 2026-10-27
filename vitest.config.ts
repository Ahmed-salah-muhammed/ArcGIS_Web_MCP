import { defineConfig } from "vitest/config";

// Unit tests run in Node (fetch, crypto.subtle, btoa and URL are built in). They cover the pure ArcGIS/portal
// logic with a fake fetch/request - nothing reaches the network and no ArcGIS account is needed.
export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
	},
});
