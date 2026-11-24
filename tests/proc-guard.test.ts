/**
 * 测试 proc-guard.ts — 进程身份探测 / 死透等待 / 树杀
 *
 * 执行器注入 mock，不触碰真实进程；清扫测试见 sweep-stale.test.ts。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	readProcPid,
	resolvePlatformPid,
	isPidAlive,
	killTree,
	waitForPidExit,
	type ProcGuardExecutor,
} from "../proc-guard";

// ─── readProcPid / resolvePlatformPid ───────────────────

describe("readProcPid", () => {
	it("解析合法自报文件（shellPid winpid）", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-test-"));
		try {
			fs.writeFileSync(path.join(dir, "proc.pid"), "1234 5678\n");
			expect(readProcPid(dir)).toEqual({ shellPid: 1234, winpid: 5678 });
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	it("winpid 为 0 也解析（Unix 平台仍可用 shell pid）", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-test-"));
		try {
			fs.writeFileSync(path.join(dir, "proc.pid"), "1234 0");
			expect(readProcPid(dir)).toEqual({ shellPid: 1234, winpid: 0 });
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	it("文件缺失返回 null", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-test-"));
		try {
			expect(readProcPid(dir)).toBeNull();
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	it("格式异常（非数字/单段/shellPid<=0）返回 null", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-test-"));
		try {
			fs.writeFileSync(path.join(dir, "proc.pid"), "not a pid");
			expect(readProcPid(dir)).toBeNull();
			fs.writeFileSync(path.join(dir, "proc.pid"), "999");
			expect(readProcPid(dir)).toBeNull();
			fs.writeFileSync(path.join(dir, "proc.pid"), "0 0");
			expect(readProcPid(dir)).toBeNull();
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});
});

describe("resolvePlatformPid — 平台适用 pid", () => {
	it("info 为 null 返回 null", () => {
		expect(resolvePlatformPid(null)).toBeNull();
	});
	it("win32 下判 winpid；winpid=0 无可用 pid", () => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		try {
			expect(resolvePlatformPid({ shellPid: 1, winpid: 2 })).toBe(2);
			expect(resolvePlatformPid({ shellPid: 1, winpid: 0 })).toBeNull();
		} finally { vi.unstubAllGlobals(); }
	});
	it("非 win32 下判 shell pid；winpid=0 不构成降级信号", () => {
		vi.stubGlobal("process", { ...process, platform: "linux" });
		try {
			expect(resolvePlatformPid({ shellPid: 5, winpid: 0 })).toBe(5);
			expect(resolvePlatformPid({ shellPid: 5, winpid: 99 })).toBe(5);
		} finally { vi.unstubAllGlobals(); }
	});
});

// ─── isPidAlive / killTree / waitForPidExit（执行器注入） ────

const makeExecutor = (stdout: string | null): ProcGuardExecutor => ({
	run: vi.fn(() => stdout),
});

describe("isPidAlive（win32 分支）", () => {
	beforeEach(() => { vi.stubGlobal("process", { ...process, platform: "win32" }); });
	afterEach(() => { vi.unstubAllGlobals(); });

	it("stdout 含 pid 判活", () => {
		const ex = makeExecutor("bash.exe    1234 Console 1 2,048 K");
		expect(isPidAlive(1234, ex)).toBe(true);
	});
	it("stdout 不含 pid（INFO: No tasks）判死", () => {
		const ex = makeExecutor("INFO: No tasks are running which match the specified criteria.");
		expect(isPidAlive(1234, ex)).toBe(false);
	});
	it("探测命令失败（null）fail-safe 判活", () => {
		const ex = makeExecutor(null);
		expect(isPidAlive(1234, ex)).toBe(true);
	});
	it("pid<=0 判死", () => {
		expect(isPidAlive(0, makeExecutor("anything 0"))).toBe(false);
	});
});

describe("isPidAlive（Unix 分支）", () => {
	beforeEach(() => { vi.stubGlobal("process", { ...process, platform: "linux" }); });
	afterEach(() => { vi.unstubAllGlobals(); });

	it("非 EPERM 异常判死（进程不存在）", () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
			const err = new Error("no such process") as NodeJS.ErrnoException;
			err.code = "ESRCH";
			throw err;
		});
		try {
			expect(isPidAlive(4242, makeExecutor(null))).toBe(false);
		} finally { killSpy.mockRestore(); }
	});
	it("EPERM 判活（进程存在但无权限探测）", () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
			const err = new Error("not permitted") as NodeJS.ErrnoException;
			err.code = "EPERM";
			throw err;
		});
		try {
			expect(isPidAlive(4242, makeExecutor(null))).toBe(true);
		} finally { killSpy.mockRestore(); }
	});
	it("无异常判活", () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
		try {
			expect(isPidAlive(4242, makeExecutor(null))).toBe(true);
		} finally { killSpy.mockRestore(); }
	});
	it("pid<=0 判死", () => {
		expect(isPidAlive(-1, makeExecutor(null))).toBe(false);
	});
});

describe("killTree", () => {
	it("win32 用 taskkill /T /F /PID 树杀", () => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		try {
			const ex = makeExecutor("");
			killTree(777, ex);
			expect(ex.run).toHaveBeenCalledWith("taskkill", ["/T", "/F", "/PID", "777"]);
		} finally { vi.unstubAllGlobals(); }
	});
	it("Unix 用 kill -9 直接目标", () => {
		vi.stubGlobal("process", { ...process, platform: "linux" });
		try {
			const ex = makeExecutor("");
			killTree(777, ex);
			expect(ex.run).toHaveBeenCalledWith("kill", ["-9", "777"]);
		} finally { vi.unstubAllGlobals(); }
	});
	it("pid<=0 不执行", () => {
		const ex = makeExecutor("");
		killTree(0, ex);
		expect(ex.run).not.toHaveBeenCalled();
	});
});

describe("waitForPidExit", () => {
	it("已死透立即返回 true（一次探测即出）", async () => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		try {
			const ex = makeExecutor("INFO: No tasks are running");
			const dead = await waitForPidExit(1234, { executor: ex, sleep: async () => {} });
			expect(dead).toBe(true);
			expect(ex.run).toHaveBeenCalledTimes(1);
		} finally { vi.unstubAllGlobals(); }
	});
	it("持续存活超时返回 false", async () => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		try {
			const ex = makeExecutor("bash.exe 1234 Console");
			const dead = await waitForPidExit(1234, {
				timeoutMs: 10,
				intervalMs: 5,
				sleep: async () => {},
				executor: ex,
			});
			expect(dead).toBe(false);
		} finally { vi.unstubAllGlobals(); }
	});
});
