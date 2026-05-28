/**
 * 测试 subagent-spawn-once.ts：spawnOnce
 *
 * 通过 mock node:child_process 的 spawn 来测试各种场景。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock getPiCommand
vi.mock("../subagent-utils", () => ({
	getPiCommand: vi.fn(() => ({ command: "node", args: ["/usr/local/bin/pi"] })),
}));

import { EventEmitter } from "node:events";

let mockProc: any;
const spawnCalls: any[][] = [];

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal() as any;
	return {
		...actual,
		spawn: (...args: any[]) => {
			spawnCalls.push(args);
			return mockProc;
		},
	};
});

import { spawnOnce } from "../subagent-spawn-once";

function createMockProcess() {
	const proc = new EventEmitter() as any;
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();
	proc.killed = false;
	return proc;
}

describe("spawnOnce", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockProc = createMockProcess();
		spawnCalls.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("正常执行并收集输出", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });

		// 模拟 session 开始
		mockProc.stdout.emit("data", Buffer.from('{"type":"session","version":1,"id":"sess-1"}\n'));
		// 模拟 message_end
		mockProc.stdout.emit("data", Buffer.from('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}\n'));
		// 模拟 close
		mockProc.emit("close", 0);

		const result = await resultPromise;
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("hello");
		expect(result.subSessionId).toBe("sess-1");
	});

	it("工具事件通过 onEvent 回调", async () => {
		const onEvent = vi.fn();
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, onEvent);

		mockProc.stdout.emit("data", Buffer.from('{"type":"tool_execution_start","toolName":"read"}\n'));
		mockProc.emit("close", 0);

		await resultPromise;
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "tool", toolName: "read" }));
	});

	it("thinking 事件通过 onEvent 回调", async () => {
		const onEvent = vi.fn();
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, onEvent);

		mockProc.stdout.emit("data", Buffer.from('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"thinking..."}}\n'));
		mockProc.emit("close", 0);

		await resultPromise;
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "thinking" }));
	});

	it("进程错误时返回 error 信息", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });

		mockProc.emit("error", new Error("spawn failed"));

		const result = await resultPromise;
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("spawn failed");
	});

	it("超时时终止进程", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, 5000);

		// 推进时间到超时
		vi.advanceTimersByTime(6000);

		const result = await resultPromise;
		expect(result.timedOut).toBe(true);
		expect(mockProc.kill).toHaveBeenCalled();
	});

	it("signal abort 时终止进程（有 sessionId）", async () => {
		const controller = new AbortController();
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, controller.signal);

		// 先发送 session 事件以捕获 sessionId
		mockProc.stdout.emit("data", Buffer.from('{"type":"session","version":1,"id":"sess-abort"}\n'));

		controller.abort();

		const result = await resultPromise;
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("aborted");
	});

	it("没有输出时返回 (no output)", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });

		mockProc.emit("close", 0);

		const result = await resultPromise;
		expect(result.output).toBe("(no output)");
	});

	it("model override 传递给 pi 命令", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, "gpt-4");

		mockProc.emit("close", 0);
		await resultPromise;

		const args = spawnCalls[0][1];
		expect(args).toContain("--model");
		expect(args).toContain("gpt-4");
	});

	it("agentDef.model 作为默认 model", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"], model: "claude-3" });

		mockProc.emit("close", 0);
		await resultPromise;

		const args = spawnCalls[0][1];
		expect(args).toContain("--model");
		expect(args).toContain("claude-3");
	});
});
