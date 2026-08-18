/**
 * 测试 subagent.ts：runSubagent（spawn 路径选择 / 超时解析 / 桥接注入 / 约束重试）
 * validateOutputConstraints 的测试在 output-constraints.test.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock shared-utils (loadAgentDef 已收敛到 shared-utils)
vi.mock("@pi-atelier/shared-utils", () => ({
	loadAgentDef: vi.fn(),
	getEffectiveConfig: vi.fn(() => ({ config: {}, sources: {} })),
}));

// mock 超时解析（runSubagent 内部调用）
vi.mock("../timeout-config", () => ({
	resolveSubagentTimeout: vi.fn(() => 30 * 60 * 1000),
	DEFAULT_SUBAGENT_TIMEOUT_MS: 30 * 60 * 1000,
	SUBAGENT_TIMEOUT_DEFAULTS: { timeoutMs: 1800000, agentTimeouts: {} },
}));

// mock 桥接（runSubagent 内部调用）
vi.mock("../intercom-bridge", () => ({
	buildIntercomBridge: vi.fn(() => ({ PI_SUBAGENT_RUN_ID: "run-test" })),
	resolveOrchestratorName: vi.fn(async () => undefined),
	setOrchestratorNameResolver: vi.fn(),
}));

// mock subagent-utils
vi.mock("../subagent-utils", () => ({
	writeTempPrompt: vi.fn().mockResolvedValue("/tmp/pi-pv-xxx/system-prompt.md"),
	getPiCommand: vi.fn(),
}));

// mock spawn
vi.mock("../subagent-spawn-once", () => ({
	spawnOnce: vi.fn(),
}));

vi.mock("../subagent-spawn-visible", () => ({
	spawnVisible: vi.fn(),
}));

import { loadAgentDef } from "@pi-atelier/shared-utils";
import { spawnOnce } from "../subagent-spawn-once";
import { spawnVisible } from "../subagent-spawn-visible";
import { resolveSubagentTimeout } from "../timeout-config";
import { runSubagent } from "../subagent";

describe("runSubagent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 默认模拟无分屏终端，走 spawnOnce
		delete process.env.TMUX;
		delete process.env.WEZTERM_PANE;
	});

	it("agentDef 未找到时抛错", async () => {
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue(null);
		await expect(runSubagent("nonexistent", "task", "/cwd")).rejects.toThrow("未找到");
	});

	it("正常执行返回结果（无约束）", async () => {
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "done",
			stderr: "",
		});

		const result = await runSubagent("test-agent", "do something", "/cwd", undefined, undefined, undefined, undefined, undefined, false);
		expect(result.output).toBe("done");
		expect(result.exitCode).toBe(0);
		// 后台模式默认注入桥接环境变量
		const spawnArgs = (spawnOnce as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(spawnArgs[9]).toEqual(expect.objectContaining({ PI_SUBAGENT_RUN_ID: "run-test" }));
	});

	it("extraEnv 与桥接变量合并，extraEnv 优先", async () => {
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "done",
			stderr: "",
		});

		await runSubagent("test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, undefined, false, { PI_SUBAGENT_RUN_ID: "run-custom" });
		const spawnArgs = (spawnOnce as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(spawnArgs[9]).toEqual({ PI_SUBAGENT_RUN_ID: "run-custom" });
	});

	it("超时未显式传参时经配置链解析后传给 spawn", async () => {
		(resolveSubagentTimeout as ReturnType<typeof vi.fn>).mockReturnValue(123456);
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "done",
			stderr: "",
		});

		await runSubagent("test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, undefined, false);
		expect(resolveSubagentTimeout).toHaveBeenCalledWith("test-agent", "/cwd", undefined);
		const spawnArgs = (spawnOnce as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
		expect(spawnArgs[6]).toBe(123456);
	});

	it("有 TMUX 时走 spawnVisible", async () => {
		process.env.TMUX = "1";
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});
		(spawnVisible as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "visible done",
			stderr: "",
		});

		const result = await runSubagent("test-agent", "do something", "/cwd");
		expect(spawnVisible).toHaveBeenCalled();
		expect(result.output).toBe("visible done");
		delete process.env.TMUX;
	});

	it("有 WEZTERM_PANE 时也走 spawnVisible", async () => {
		process.env.WEZTERM_PANE = "7";
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});
		(spawnVisible as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "wez done",
			stderr: "",
		});

		await runSubagent("test-agent", "do something", "/cwd");
		expect(spawnVisible).toHaveBeenCalled();
		delete process.env.WEZTERM_PANE;
	});

	it("约束不通过时重试", async () => {
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});

		// 第一次不通过，第二次通过
		(spawnOnce as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ exitCode: 0, output: "bad format", stderr: "" })
			.mockResolvedValueOnce({ exitCode: 0, output: "GOOD format", stderr: "" });

		const constraints = [{
			rule: "必须包含 GOOD",
			validate: (s: string) => s.includes("GOOD") ? null : "缺少 GOOD",
		}];

		const result = await runSubagent("test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, constraints, false);
		expect(spawnOnce).toHaveBeenCalledTimes(2);
		expect(result.output).toBe("GOOD format");
	});

	it("约束重试 MAX_RETRIES 后仍不通过，返回最后结果", async () => {
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});

		// 三次都不通过
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "always bad",
			stderr: "",
		});

		const constraints = [{
			rule: "必须包含 GOOD",
			validate: (s: string) => s.includes("GOOD") ? null : "缺少 GOOD",
		}];

		const result = await runSubagent("test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, constraints, false);
		expect(spawnOnce).toHaveBeenCalledTimes(3); // initial + 2 retries
		expect(result.output).toBe("always bad");
	});
});
