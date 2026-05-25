import { defineConfig } from "vitest/config";

// workflow 的测试使用内联实现（不依赖真实 pi 包）
// peerDependencies 由 pi 运行时解析，测试阶段不需要
export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts"],
		exclude: ["**/*.subagent.test.ts"],
	},
});
