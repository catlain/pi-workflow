/**
 * 测试 visible-cleanup.ts — 有序安全清理的调用顺序契约
 *
 * 核心断言：目录删除（rmSync）永不早于 pane 内进程死透确认 / 树杀兜底；
 * 降级分支 kill 场景保留 killPane。proc-guard 全 mock，不触碰真实进程与文件。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
	rmSync: vi.fn(),
	existsSync: vi.fn(() => false),
	readFileSync: vi.fn(() => { throw new Error("no fs in cleanup test"); }),
}));

vi.mock("../proc-guard", () => ({
	readProcPid: vi.fn(() => ({ shellPid: 111, winpid: 222 })),
	resolvePlatformPid: vi.fn(() => 222),
	waitForPidExit: vi.fn(() => Promise.resolve(true)),
	killTree: vi.fn(),
}));

import * as fs from "node:fs";
import { waitForPidExit, killTree, resolvePlatformPid } from "../proc-guard";
import { createSafeCleanup } from "../visible-cleanup";
import type { TermBackend } from "../term-backend";

const fsMock = vi.mocked(fs);
const mockedWait = vi.mocked(waitForPidExit);
const mockedKillTree = vi.mocked(killTree);
const mockedResolve = vi.mocked(resolvePlatformPid);

const makeBackend = (calls: string[]) => ({
	splitPane: vi.fn(() => "%1"),
	killPane: vi.fn((id: string) => { calls.push(`killPane:${id}`); }),
	isPaneAlive: vi.fn(() => true),
}) as unknown as TermBackend;

const makeCalls = () => [] as string[];

describe("createSafeCleanup — 顺序契约", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// clearAllMocks 不清 mockReturnValue，逐项恢复默认（防降级用例的 null 污染后续）
		mockedWait.mockReturnValue(Promise.resolve(true));
		mockedResolve.mockReturnValue(222);
	});

	it("kill=true 且死透：killPane → 死透确认 → 删除，不树杀", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		mockedWait.mockImplementation(async () => {
			calls.push("confirmed-dead");
			return true;
		});
		fsMock.rmSync.mockImplementation(() => calls.push("rmSync"));

		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		await safeCleanup(true);

		expect(calls).toEqual(["killPane:%42", "confirmed-dead", "rmSync"]);
		expect(mockedKillTree).not.toHaveBeenCalled();
	});

	it("kill=true 且 10s 未死透：killPane → 等待超时 → 树杀兜底 → 删除", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		mockedWait.mockResolvedValue(false);
		mockedKillTree.mockImplementation(() => calls.push("killTree"));
		fsMock.rmSync.mockImplementation(() => calls.push("rmSync"));

		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		await safeCleanup(true);

		expect(calls).toEqual(["killPane:%42", "killTree", "rmSync"]);
	});

	it("kill=false（正常结束）死透：不主动杀 pane，只等死透后删除", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		fsMock.rmSync.mockImplementation(() => calls.push("rmSync"));

		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		await safeCleanup(false);

		expect(calls).toEqual(["rmSync"]);
		expect((backend as any).killPane).not.toHaveBeenCalled();
		expect(mockedWait).toHaveBeenCalledWith(222);
	});

	it("kill=false 且等待超时未死透：同样树杀兜底后删除（防误判路径写已删文件）", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		mockedWait.mockResolvedValue(false);
		mockedKillTree.mockImplementation(() => calls.push("killTree"));
		fsMock.rmSync.mockImplementation(() => calls.push("rmSync"));

		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		await safeCleanup(false);

		expect(calls).toEqual(["killTree", "rmSync"]);
	});

	it("身份缺失降级（kill=true）：仍先 killPane，再延迟删除，不等待死透", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		mockedResolve.mockReturnValue(null);
		fsMock.rmSync.mockImplementation(() => calls.push("rmSync"));

		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		vi.useFakeTimers();
		const pending = safeCleanup(true);
		// killPane 立即执行（同步分支），删除在 10s 延迟后
		expect(calls).toEqual(["killPane:%42"]);
		await vi.advanceTimersByTimeAsync(10_000);
		await pending;
		expect(calls).toEqual(["killPane:%42", "rmSync"]);
		expect(mockedWait).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("身份缺失降级（kill=false）：不杀 pane，延迟删除（不劣于现状且更保守）", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		mockedResolve.mockReturnValue(null);
		fsMock.rmSync.mockImplementation(() => calls.push("rmSync"));

		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		vi.useFakeTimers();
		const pending = safeCleanup(false);
		expect(calls).toEqual([]);
		await vi.advanceTimersByTimeAsync(10_000);
		await pending;
		expect(calls).toEqual(["rmSync"]);
		vi.useRealTimers();
	});

	it("后端无关性：清理仅消费 TermBackend 的 killPane 接口，不触 splitPane/isPaneAlive", async () => {
		const calls = makeCalls();
		const backend = makeBackend(calls);
		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		await safeCleanup(true);
		expect((backend as any).splitPane).not.toHaveBeenCalled();
		expect((backend as any).isPaneAlive).not.toHaveBeenCalled();
	});

	it("rmSync 抛错不影响后续清理调用（容错不抛出）", async () => {
		const backend = makeBackend([]);
		fsMock.rmSync.mockImplementation(() => { throw new Error("EPERM"); });
		const safeCleanup = createSafeCleanup({ taskDir: "/tmp/pi-visible-x", paneId: "%42", backend });
		await expect(safeCleanup(true)).resolves.toBeUndefined();
	});
});
