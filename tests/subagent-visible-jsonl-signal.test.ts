/**
 * 测试 F1 修复的 visible 模式 jsonl 终结形态判定
 * （opsx-subarch-meta-baseline，spec: subagent-spawn-runtime，D-C1-4b）
 *
 * visible spawn 的 finish()（close 分支）信号源 = 子会话 session.jsonl：
 * 三形态 + 超时分支不受干扰的防护用例。
 * mock 骨架对齐 subagent-spawn-visible.test.ts（term-backend/fs/subagent-utils）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../subagent-utils", () => ({
	getPiCommand: vi.fn(() => ({ command: "node", args: ["/usr/local/bin/pi"] })),
	createVisibleTaskDir: vi.fn(() => ({
		taskDir: "/tmp/pi-visible-xxx",
		taskFile: "/tmp/pi-visible-xxx/task.txt",
		sessionFile: "/tmp/pi-visible-xxx/session.jsonl",
		launchScript: "/tmp/pi-visible-xxx/launch.sh",
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
		isPaneAlive: vi.fn(() => false),
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
vi.mock("node:fs", () => ({ default: fsMock, ...fsMock }));

const { safeCleanupMock } = vi.hoisted(() => ({ safeCleanupMock: vi.fn(() => Promise.resolve()) }));
vi.mock("../visible-cleanup", () => ({
	createSafeCleanup: () => safeCleanupMock,
}));

import { spawnVisible } from "../subagent-spawn-visible";

describe("spawnVisible jsonl 终结形态判定（visible 失败信号源，D-C1-4b）", () => {
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		termDetect.set("tmux");
		backendMock.splitPane.mockClear().mockReturnValue("%42");
		backendMock.killPane.mockClear();
		backendMock.isPaneAlive.mockReturnValue(false); // pane 消失 → close → finish()
		safeCleanupMock.mockClear();
		fsMock.existsSync.mockReturnValue(false);
		fsMock.readFileSync.mockReturnValue("");
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("形态①：jsonl 缺失 → error 注入「信号源=jsonl 终结形态」系统性失败档", async () => {
		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		await vi.advanceTimersByTimeAsync(5000);
		const result = await resultPromise;
		expect(result.error).toContain("visible 模式信号源=jsonl 终结形态");
		expect(result.error).toContain("session.jsonl 缺失");
	});

	it("形态②：jsonl 存在但无 message 事件 → error 注入系统性失败档", async () => {
		fsMock.existsSync.mockReturnValue(true);
		// 只有 session 头事件，无 message（未进入对话阶段 = spawn 层阵亡）
		fsMock.readFileSync.mockReturnValue('{"type":"session","id":"abc"}\n');
		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		await vi.advanceTimersByTimeAsync(5000);
		const result = await resultPromise;
		expect(result.error).toContain("visible 模式信号源=jsonl 终结形态");
		expect(result.error).toContain("无 message 事件");
	});

	it("形态③：jsonl 正常终结（有 message 事件）→ 无 error，维持现状零输出档", async () => {
		fsMock.existsSync.mockReturnValue(true);
		fsMock.readFileSync.mockReturnValue('{"type":"message","message":{"role":"assistant","content":[]}}\n');
		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		await vi.advanceTimersByTimeAsync(5000);
		const result = await resultPromise;
		expect(result.error).toBeUndefined();
	});

	it("防护：超时分支不受 jsonl 判定干扰（timedOut 布尔是原有信号，非 error 字段）", async () => {
		backendMock.isPaneAlive.mockReturnValue(true); // pane 存活 → 超时分支
		const resultPromise = spawnVisible("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, 1000);
		await vi.advanceTimersByTimeAsync(3000);
		const result = await resultPromise;
		expect(result.timedOut).toBe(true);
		expect(result.error).toBeUndefined();
	});
});
