/**
 * 测试 timeout-config.ts — 超时优先级链解析
 *
 * 优先级：fallback(30min) < timeoutMs < agentTimeouts[name] < 显式传参
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock getEffectiveConfig（三层合并由 shared-utils 测试覆盖，这里只测优先级链）
const { configMock } = vi.hoisted(() => ({
	configMock: {
		set: (v: any) => { (configMock as any).__v = v; },
		get: () => (configMock as any).__v,
	},
}));

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: vi.fn((section: string, defaults: any) => ({
		config: { ...defaults, ...(configMock.get() ?? {}) },
		sources: {},
	})),
}));

import { resolveSubagentTimeout, DEFAULT_SUBAGENT_TIMEOUT_MS } from "../timeout-config";
import { getEffectiveConfig } from "@pi-atelier/shared-utils";

describe("resolveSubagentTimeout — 优先级链", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		configMock.set(undefined);
	});

	it("无任何配置时返回 30min fallback", () => {
		expect(resolveSubagentTimeout("any", "/cwd")).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);
		expect(DEFAULT_SUBAGENT_TIMEOUT_MS).toBe(30 * 60 * 1000);
	});

	it("timeoutMs 配置覆盖 fallback", () => {
		configMock.set({ timeoutMs: 1800000 });
		expect(resolveSubagentTimeout("any", "/cwd")).toBe(1800000);
	});

	it("agentTimeouts 条目覆盖 timeoutMs", () => {
		configMock.set({ timeoutMs: 1800000, agentTimeouts: { "fo-analyzer": 3600000 } });
		expect(resolveSubagentTimeout("fo-analyzer", "/cwd")).toBe(3600000);
		// 其他 agent 不受影响，走 timeoutMs
		expect(resolveSubagentTimeout("fo-verifier", "/cwd")).toBe(1800000);
	});

	it("显式传参优先级最高", () => {
		configMock.set({ timeoutMs: 1800000, agentTimeouts: { "fo-analyzer": 3600000 } });
		expect(resolveSubagentTimeout("fo-analyzer", "/cwd", 600000)).toBe(600000);
	});

	it("显式传参 0 或负值视为未传", () => {
		configMock.set({ timeoutMs: 1800000 });
		expect(resolveSubagentTimeout("x", "/cwd", 0)).toBe(1800000);
		expect(resolveSubagentTimeout("x", "/cwd", -1)).toBe(1800000);
	});

	it("无效配置值（非正数）回退低优先级来源", () => {
		configMock.set({ timeoutMs: 0, agentTimeouts: { bad: -5 } });
		expect(resolveSubagentTimeout("bad", "/cwd")).toBe(DEFAULT_SUBAGENT_TIMEOUT_MS);
	});

	it("经 getEffectiveConfig 三层合并读取（cwd 传递）", () => {
		configMock.set({ timeoutMs: 900000 });
		resolveSubagentTimeout("x", "/proj/dir");
		expect(getEffectiveConfig).toHaveBeenCalledWith(
			"subagent",
			expect.objectContaining({ timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS, agentTimeouts: {} }),
			"/proj/dir",
		);
	});
});
