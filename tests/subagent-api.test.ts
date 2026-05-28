/**
 * 测试 subagent.ts：validateOutputConstraints + runSubagent
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock agent-loader
vi.mock("../agent-loader", () => ({
	loadAgentDef: vi.fn(),
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

import { validateOutputConstraints } from "../subagent";
import { loadAgentDef } from "../agent-loader";
import { spawnOnce } from "../subagent-spawn-once";
import { spawnVisible } from "../subagent-spawn-visible";

describe("validateOutputConstraints", () => {
	it("无约束时返回空列表", () => {
		expect(validateOutputConstraints("hello", [])).toEqual([]);
	});

	it("全部通过返回空列表", () => {
		const constraints = [
			{ rule: "必须是 JSON", validate: (s: string) => (s.startsWith("{") ? null : "not json") },
		];
		expect(validateOutputConstraints('{"ok":true}', constraints)).toEqual([]);
	});

	it("有不通过的返回错误列表", () => {
		const constraints = [
			{ rule: "必须是 JSON", validate: (s: string) => (s.startsWith("{") ? null : "not json") },
			{ rule: "包含 ok", validate: (s: string) => (s.includes("ok") ? null : "missing ok") },
		];
		expect(validateOutputConstraints("plain text", constraints)).toEqual(["not json", "missing ok"]);
	});

	it("部分通过只返回不通过的", () => {
		const constraints = [
			{ rule: "包含 ok", validate: (s: string) => (s.includes("ok") ? null : "missing ok") },
			{ rule: "包含 err", validate: (s: string) => (s.includes("err") ? null : "missing err") },
		];
		expect(validateOutputConstraints("has ok but not e", constraints)).toEqual(["missing err"]);
	});
});

describe("runSubagent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 默认模拟 TMUX 不存在，走 spawnOnce
		delete process.env.TMUX;
	});

	it("agentDef 未找到时抛错", async () => {
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue(null);
		const { runSubagent } = await import("../subagent");
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

		const { runSubagent } = await import("../subagent");
		const result = await runSubagent("test-agent", "do something", "/cwd", undefined, undefined, undefined, undefined, undefined, false);
		expect(result.output).toBe("done");
		expect(result.exitCode).toBe(0);
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

		const { runSubagent } = await import("../subagent");
		const result = await runSubagent("test-agent", "do something", "/cwd");
		expect(spawnVisible).toHaveBeenCalled();
		expect(result.output).toBe("visible done");
		delete process.env.TMUX;
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

		const { runSubagent } = await import("../subagent");
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

		const { runSubagent } = await import("../subagent");
		const result = await runSubagent("test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, constraints, false);
		expect(spawnOnce).toHaveBeenCalledTimes(3); // initial + 2 retries
		expect(result.output).toBe("always bad");
	});
});
