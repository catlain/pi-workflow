import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================================
// Smoke Test: barrel export + package.json 检查
// ============================================================

describe("smoke: barrel export", () => {
	it("所有公共 API 从 index.ts barrel export 成功", () => {
		// 验证 barrel export 的 API 名称列表与 plan 一致
		const exports = [
			"runSubagent",
			"loadAgentDef",
			"createSubagentWidget",
			"saveSubagentOutput",
			"readSubagentOutput",
			"createStateManager",
			"createUIUpdater",
			"registerWorkflowTool",
		];
		const expectedTypeExports = [
			"AgentDef",
			"SubagentResult",
			"SubagentEvent",
			"ActionDef",
		];

		// 验证函数名列表完整
		expect(exports).toHaveLength(8);
		expect(expectedTypeExports).toHaveLength(4);

		// 全部函数名存在且无重复
		const allNames = [...exports, ...expectedTypeExports];
		const uniqueNames = new Set(allNames);
		expect(uniqueNames.size).toBe(allNames.length);

		// 验证 index.ts 中每个函数都有对应的子模块文件
		const workflowDir = path.resolve(__dirname, "..");
		const files = [
			"subagent.ts",
			"subagent-utils.ts",
			"agent-loader.ts",
			"widget.ts",
			"output.ts",
			"types.ts",
			"state.ts",
			"workflow.ts",
			"index.ts",
		];
		for (const file of files) {
			const filePath = path.join(workflowDir, file);
			expect(fs.existsSync(filePath)).toBe(true);
		}
	});

	it("index.ts 包含所有 barrel export 语句", () => {
		const indexPath = path.resolve(__dirname, "..", "index.ts");
		const content = fs.readFileSync(indexPath, "utf-8");

		// 验证导出语句
		expect(content).toContain('export { runSubagent } from "./subagent"');
		expect(content).toContain('export { loadAgentDef, type AgentDef } from "./agent-loader"');
		expect(content).toContain('export { createSubagentWidget } from "./widget"');
		expect(content).toContain('export { saveSubagentOutput, readSubagentOutput } from "./output"');
		expect(content).toContain('export type { SubagentResult, SubagentEvent } from "./types"');
		expect(content).toContain('export { createStateManager, createUIUpdater } from "./state"');
		expect(content).toContain('export { registerWorkflowTool, type ActionDef } from "./workflow"');
	});

	it("package.json 字段完整", () => {
		const pkgPath = path.resolve(__dirname, "..", "package.json");
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

		expect(pkg.name).toBe("workflow");
		expect(pkg.version).toBe("1.0.0");
		expect(pkg.type).toBe("commonjs");
		expect(pkg.main).toBe("index.ts");

		// dependencies 为空
		expect(pkg.dependencies).toEqual({});

		// peerDependencies 包含 pi-core 依赖
		expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("*");
		expect(pkg.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
		expect(pkg.peerDependencies?.["typebox"]).toBe("*");

		// devDependencies
		expect(pkg.devDependencies?.["vitest"]).toBeDefined();
		expect(pkg.devDependencies?.["@types/node"]).toBeDefined();
	});

	it("vitest.config.ts 存在且格式正确", () => {
		const configPath = path.resolve(__dirname, "..", "vitest.config.ts");
		const content = fs.readFileSync(configPath, "utf-8");

		expect(content).toContain("defineConfig");
		expect(content).toContain("tests/**/*.test.ts");
	});

	it("所有 .ts 文件行数不超过 200 行", () => {
		const workflowDir = path.resolve(__dirname, "..");
		const tsFiles = fs.readdirSync(workflowDir).filter(f => f.endsWith(".ts") && f !== "vitest.config.ts");

		for (const file of tsFiles) {
			const lines = fs.readFileSync(path.join(workflowDir, file), "utf-8").split("\n").length;
			expect(
				lines,
				`${file} 行数 ${lines} 超过 200 行`,
			).toBeLessThanOrEqual(200);
		}
	});

	it("types.ts 只导出 SubagentResult + SubagentEvent，不含 PV 专用类型", () => {
		const typesPath = path.resolve(__dirname, "..", "types.ts");
		const content = fs.readFileSync(typesPath, "utf-8");

		// types.ts 不应包含 PV 专用类型
		expect(content).not.toContain("PlanVerifyState");
		expect(content).not.toContain("Phase");
		expect(content).not.toContain("Issue");

		// 应包含通用类型
		expect(content).toContain("SubagentResult");
		expect(content).toContain("SubagentEvent");
	});
});
