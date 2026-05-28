/**
 * 测试 subagent-spawn-visible.ts：spawnVisible
 *
 * spawnVisible 深度依赖 tmux + execFileSync + 轮询。
 * 当 tmux 不可用时，会 fallback 到 spawnOnce。
 * 这里主要测试：tmux 成功路径 + fallback 路径 + 超时 + abort。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../subagent-utils", () => ({
	getPiCommand: vi.fn(() => ({ command: "node", args: ["/usr/local/bin/pi"] })),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({}));
vi.mock("../subagent-spawn-once", () => ({
	spawnOnce: vi.fn(() => Promise.resolve({ exitCode: 0, output: "fallback", stderr: "" })),
}));

const { childProcessMock } = vi.hoisted(() => {
	const results: { error?: Error; stdout?: string }[] = [];
	let callIdx = 0;
	return {
		childProcessMock: {
			__results: results,
			__reset: () => { callIdx = 0; results.length = 0; },
			execFileSync: (...args: any[]) => {
				const r = results[callIdx++];
				if (r?.error) throw r.error;
				return r?.stdout ?? "";
			},
		},
	};
});

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal() as any;
	return { ...actual, execFileSync: childProcessMock.execFileSync };
});

const { fsMock } = vi.hoisted(() => {
	const mock = {
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => ""),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		mkdtempSync: vi.fn(() => "/tmp/pi-visible-test"),
		rmSync: vi.fn(),
	};
	return { fsMock: mock };
});

vi.mock("node:fs", () => fsMock);

import { spawnVisible } from "../subagent-spawn-visible";
import { spawnOnce } from "../subagent-spawn-once";

describe("spawnVisible", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		childProcessMock.__reset();
		fsMock.existsSync.mockReturnValue(false);
		fsMock.readFileSync.mockReturnValue("");
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("tmux 不可用时 fallback 到 spawnOnce", async () => {
		// tmux split-window 失败 → fallback
		childProcessMock.__results.push({ error: new Error("tmux not found") });

		const result = await spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		expect(spawnOnce).toHaveBeenCalled();
		expect(result.exitCode).toBe(0);
		expect(result.output).toBe("fallback");
	});

	it("tmux 成功 + pane 消失后读取结果文件", async () => {
		// 1st call: tmux split-window → 成功，返回 pane ID
		childProcessMock.__results.push({ stdout: " %42\n" });
		// 2nd+ calls: tmux list-panes → 失败（pane 已消失）触发 finish
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ error: new Error("no pane") });
		// finish 内部调 execFileSync("sleep",...) 
		childProcessMock.__results.push({ stdout: "" });

		// session 文件有内容
		fsMock.existsSync.mockReturnValue(true);
		fsMock.readFileSync.mockReturnValue('{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}\n');

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });

		// 推进时间让轮询执行（2s 间隔）
		await vi.advanceTimersByTimeAsync(5000);

		const result = await resultPromise;
		expect(result.output).toContain("hello");
	});

	it("超时时返回 timedOut", async () => {
		// tmux 成功
		childProcessMock.__results.push({ stdout: " %42\n" });
		// list-panes 一直成功（pane 存在），但无 session 文件
		for (let i = 0; i < 100; i++) {
			childProcessMock.__results.push({ stdout: "%42: [100x50] [active]" });
		}
		fsMock.existsSync.mockReturnValue(false);

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, 1000);

		// 推进到超时
		await vi.advanceTimersByTimeAsync(3000);

		const result = await resultPromise;
		expect(result.timedOut).toBe(true);
	});

	it("signal abort 时终止", async () => {
		const controller = new AbortController();

		// tmux 成功
		childProcessMock.__results.push({ stdout: " %42\n" });
		// list-panes 持续成功
		for (let i = 0; i < 100; i++) {
			childProcessMock.__results.push({ stdout: "%42" });
		}

		fsMock.existsSync.mockReturnValue(false);

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, controller.signal, undefined, 10000);

		// 触发 abort
		controller.abort();

		const result = await resultPromise;
		expect(result.stderr).toContain("aborted");
		expect(result.exitCode).toBe(1);
	});
});
