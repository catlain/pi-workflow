import { createConfig } from "../vitest.config.base";

export default createConfig({
	include: ["tests/**/*.test.ts"],
	test: {
		coverage: {
			exclude: [
				"types.ts",
				"research-types.ts",
				"vitest.config.*",
			],
		},
	},
});
