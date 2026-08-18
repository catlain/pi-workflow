/**
 * 测试 subagent-spawn-visible.ts：spawnVisible
 *
 * 新实现通过 term-backend 抽象分屏（WezTerm/tmux），测试 mock 整个后端：
 * 终端不可用 fallback / pane 消失后读取结果 / 超时 / abort。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../subagent-utils", () => ({
	getPiCommand: vi.fn(() => ({ command: "node", args: ["/usr/local/bin/pi"] })),
	createVisibleTaskDir: vi.fn(() => ({
		taskDir: "/tmp/pi-visible-test",
		taskFile: "/tmp/pi-visible-test/task.txt",
		sessionFile: "/tmp/pi-visible-test/session.jsonl",
		launchScript: "/tmp/pi-visible-test/launch.sh",
	})),
	injectParentSession: vi.fn(),
}));
vi.mock("../subagent-spawn-once", () => ({
	spawnOnce: vi.fn(() => Promise.resolve({ exitCode: 0, output: "fallback", stderr: "" })),
}));

const { backendMock, termDetect } = vi.hoisted(() => {
	const backend = {
		splitPane: vi.fn(() => "%42"),
		killPane: vi.fn(),
		isPaneAlive: vi.fn(() => true),
	};
	let detect: string | null = "tmux";
	return {
		backendMock: backend,
		termDetect: {
			set: (v: string | null) => { detect = v; },
			get: () => detect,
		},
	};
});

vi.mock("../term-backend", () => ({
	detectTerminal: () => termDetect.get(),
	getBackend: () => backendMock,
}));

const { fsMock } = vi.hoisted(() => ({
	fsMock: {
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(() => ""),
		writeFileSync: vi.fn(),
		rmSync: vi.fn(),
	},
}));

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal() as any;
	return { ...actual, ...fsMock };
});

import { spawnVisible } from "../subagent-spawn-visible";
import { spawnOnce } from "../subagent-spawn-once";
import { createVisibleTaskDir } from "../subagent-utils";

describe("spawnVisible", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		termDetect.set("tmux");
		backendMock.splitPane.mockReturnValue("%42");
		backendMock.isPaneAlive.mockReturnValue(true);
		backendMock.killPane.mockClear();
		fsMock.existsSync.mockReturnValue(false);
		fsMock.readFileSync.mockReturnValue("");
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("终端不可用时 fallback 到 spawnOnce", async () => {
		termDetect.set(null);
		const result = await spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		expect(spawnOnce).toHaveBeenCalled();
		expect(result.exitCode).toBe(0);
		expect(result.output).toBe("fallback");
	});

	it("splitPane 失败时 fallback 到 spawnOnce", async () => {
		backendMock.splitPane.mockImplementation(() => { throw new Error("split failed"); });
		const result = await spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		expect(spawnOnce).toHaveBeenCalled();
		expect(result.exitCode).toBe(0);
	});

	it("分屏成功 + pane 消失后读取结果文件", async () => {
		// pane 消失触发 finish
		backendMock.isPaneAlive.mockReturnValue(false);

		// session 文件有内容
		fsMock.existsSync.mockReturnValue(true);
		fsMock.readFileSync.mockReturnValue('{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}\n');

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });

		// 推进时间让轮询执行（2s 间隔）
		await vi.advanceTimersByTimeAsync(5000);

		const result = await resultPromise;
		expect(result.output).toContain("hello");
	});

	it("超时时返回 timedOut 并清理 pane", async () => {
		// pane 一直存活，但无 session 文件
		backendMock.isPaneAlive.mockReturnValue(true);
		fsMock.existsSync.mockReturnValue(false);

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, 1000);

		await vi.advanceTimersByTimeAsync(3000);

		const result = await resultPromise;
		expect(result.timedOut).toBe(true);
		expect(backendMock.killPane).toHaveBeenCalledWith("%42");
	});

	it("signal abort 时终止并清理", async () => {
		const controller = new AbortController();
		backendMock.isPaneAlive.mockReturnValue(true);
		fsMock.existsSync.mockReturnValue(false);

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, controller.signal, undefined, 10000);

		controller.abort();

		const result = await resultPromise;
		expect(result.stderr).toContain("aborted");
		expect(result.exitCode).toBe(1);
		expect(backendMock.killPane).toHaveBeenCalled();
	});

	it("extraEnv 透传到 createVisibleTaskDir", async () => {
		termDetect.set(null); // 直接走 fallback，验证参数传递
		await spawnVisible(
			"task", "/cwd", "/tmp/prompt.md", { tools: ["read"] },
			undefined, undefined, undefined, undefined, undefined,
			{ PI_SUBAGENT_RUN_ID: "run-abc" },
		);
		expect(createVisibleTaskDir).toHaveBeenCalledWith(
			"task", "/cwd", "/tmp/prompt.md", { tools: ["read"] },
			undefined, { PI_SUBAGENT_RUN_ID: "run-abc" },
		);
	});
});
