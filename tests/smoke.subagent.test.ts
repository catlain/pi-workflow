import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as api from "../index";

// ============================================================
// Smoke Test: 包契约检查
// 断言稳定契约（运行时导出可用、关键字段），不匹配内部源码文本，
// 避免改名/重构后断言过期长期红（2026-09-04 事故教训）。
// ============================================================

describe("smoke: 运行时导出", () => {
	it("所有公共 API 函数可从 index.ts 导入", () => {
		const functions = [
			"runSubagent",
			"loadAgentDef",
			"createSubagentWidget",
			"saveSubagentOutput",
			"readSubagentOutput",
			"createStateManager",
			"createUIUpdater",
			"registerWorkflowTool",
		];
		for (const name of functions) {
			expect(api, `缺少导出: ${name}`).toHaveProperty(name);
			expect((api as Record<string, unknown>)[name], `${name} 应为函数`).toBeTypeOf("function");
		}
	});
});

describe("smoke: package.json 稳定字段", () => {
	const pkgPath = path.resolve(__dirname, "..", "package.json");
	const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

	it("包名与入口符合发布契约", () => {
		expect(pkg.name).toBe("pi-ate-workflow");
		expect(pkg.main).toBe("index.ts");
		expect(pkg.type).toBe("commonjs");
	});

	it("peerDependencies 含 pi SDK", () => {
		expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBeDefined();
	});
});

describe("smoke: types.ts 不含 PV 专用类型", () => {
	it("types.ts 保持通用", () => {
		const typesPath = path.resolve(__dirname, "..", "types.ts");
		const content = fs.readFileSync(typesPath, "utf-8");

		expect(content).not.toContain("PlanVerifyState");
	});
});
