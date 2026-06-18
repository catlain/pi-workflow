/**
 * 测试 spawnVisible — extraEnv 参数透传到 launch.sh export 行
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
	const writtenScripts: string[] = [];
	return {
		fsMock: {
			existsSync: vi.fn(() => false),
			readFileSync: vi.fn(() => ""),
			writeFileSync: vi.fn((_path: string, content: string) => {
				if (typeof _path === "string" && _path.endsWith("launch.sh")) {
					writtenScripts.push(content);
				}
			}),
			mkdtempSync: vi.fn(() => "/tmp/pi-visible-test"),
			rmSync: vi.fn(),
			__writtenScripts: writtenScripts,
			__reset: () => { writtenScripts.length = 0; },
		},
	};
});

vi.mock("node:fs", () => fsMock);

import { spawnVisible } from "../subagent-spawn-visible";
import { spawnOnce } from "../subagent-spawn-once";

describe("spawnVisible — extraEnv 透传", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		childProcessMock.__reset();
		fsMock.__reset();
		fsMock.existsSync.mockReturnValue(false);
		fsMock.readFileSync.mockReturnValue("");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("extraEnv 写入 launch.sh export 行", async () => {
		const extraEnv = {
			PI_SUBAGENT_ORCHESTRATOR_TARGET: "my-session",
			PI_SUBAGENT_RUN_ID: "run-abc",
			PI_SUBAGENT_CHILD_AGENT: "pv-test",
			PI_SUBAGENT_CHILD_INDEX: "1",
		};

		// tmux split-window 成功 → list-panes pane 消失 → sleep
		childProcessMock.__results.push({ stdout: " %42\n" });
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ stdout: "" });

		fsMock.existsSync.mockReturnValue(true);
		fsMock.readFileSync.mockReturnValue("");

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, undefined, extraEnv);

		await vi.advanceTimersByTimeAsync(5000);
		await resultPromise;

		const script = fsMock.__writtenScripts[0];
		expect(script).toContain("export PI_SUBAGENT_ORCHESTRATOR_TARGET='my-session'");
		expect(script).toContain("export PI_SUBAGENT_RUN_ID='run-abc'");
		expect(script).toContain("export PI_SUBAGENT_CHILD_AGENT='pv-test'");
		expect(script).toContain("export PI_SUBAGENT_CHILD_INDEX='1'");
	});

	it("不传 extraEnv 时 launch.sh 不包含 PI_SUBAGENT_ export", async () => {
		childProcessMock.__results.push({ stdout: " %42\n" });
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ stdout: "" });

		fsMock.existsSync.mockReturnValue(true);
		fsMock.readFileSync.mockReturnValue("");

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		await vi.advanceTimersByTimeAsync(5000);
		await resultPromise;

		const script = fsMock.__writtenScripts[0];
		expect(script).not.toContain("PI_SUBAGENT_ORCHESTRATOR_TARGET");
	});

	it("值含单引号时安全转义", async () => {
		const extraEnv = { TEST_KEY: "it's a value" };
		childProcessMock.__results.push({ stdout: " %42\n" });
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ error: new Error("no pane") });
		childProcessMock.__results.push({ stdout: "" });

		fsMock.existsSync.mockReturnValue(true);
		fsMock.readFileSync.mockReturnValue("");

		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, undefined, extraEnv);
		await vi.advanceTimersByTimeAsync(5000);
		await resultPromise;

		const script = fsMock.__writtenScripts[0];
		expect(script).toContain("export TEST_KEY='it'\\''s a value'");
	});

	it("tmux fallback 时 extraEnv 透传到 spawnOnce", async () => {
		const extraEnv = { PI_SUBAGENT_RUN_ID: "run-fallback" };

		// tmux split-window 失败 → fallback
		childProcessMock.__results.push({ error: new Error("tmux not found") });

		await spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, undefined, extraEnv);

		expect(spawnOnce).toHaveBeenCalledWith(
			expect.any(String), expect.any(String), expect.any(String), expect.any(Object),
			undefined, undefined, undefined, undefined, undefined, extraEnv,
		);
	});
});
