/**
 * proc-guard: 可见子代理进程身份探测与树杀
 *
 * 清理安全性基建：launch.sh 启动最前自报 proc.pid（"shellPid winpid"），
 * 清理侧据此判定 pane 内进程树死透——目录删除动作永不早于死透确认。
 *
 * 平台适用 pid 语义：Windows 用 winpid（MSYS2 bash 的 $$ 是 MSYS pid，
 * taskkill 无法消费），Unix 用 shell pid（$$ 本身即平台原生 pid，
 * winpid=0 只是"无 Windows 原生 pid"标记，不构成 Unix 的降级信号）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

/** 执行器抽象（依赖注入，测试可 mock；探测失败返回 null） */
export interface ProcGuardExecutor {
	run(cmd: string, args: string[]): string | null;
}

const defaultExecutor: ProcGuardExecutor = {
	run(cmd, args) {
		try {
			return execFileSync(cmd, args, {
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			return null;
		}
	},
};

/** proc.pid 自报信息（launch.sh 首行写入） */
export interface ProcPidInfo {
	shellPid: number;
	winpid: number;
}

/** 读取任务目录的 proc.pid；缺失/格式异常返回 null（走降级链） */
export function readProcPid(taskDir: string): ProcPidInfo | null {
	try {
		const raw = fs.readFileSync(path.join(taskDir, "proc.pid"), "utf-8").trim();
		const m = raw.match(/^(\d+)\s+(\d+)$/);
		if (!m) return null;
		const shellPid = Number(m[1]);
		const winpid = Number(m[2]);
		if (shellPid <= 0) return null;
		return { shellPid, winpid };
	} catch {
		return null;
	}
}

/** 平台适用 pid：Windows 判 winpid，Unix 判 shell pid；无可用 pid 返回 null */
export function resolvePlatformPid(info: ProcPidInfo | null): number | null {
	if (!info) return null;
	if (process.platform === "win32") {
		return info.winpid > 0 ? info.winpid : null;
	}
	return info.shellPid > 0 ? info.shellPid : null;
}

/**
 * 判定 pid 是否存活。
 * 探测命令失败（返回 null）时按存活处理——fail-safe，宁可多等/树杀，不误判死。
 */
export function isPidAlive(pid: number, executor: ProcGuardExecutor = defaultExecutor): boolean {
	if (pid <= 0) return false;
	if (process.platform === "win32") {
		const out = executor.run("tasklist", ["/FI", `PID eq ${pid}`, "/NH"]);
		if (out === null) return true; // 探测失败按存活处理（fail-safe：不误删）
		// tasklist /NH 数据行格式：imagename  pid  session  session#  mem
		// 按第二列精确匹配，防内存列数字子串误判（如 "22,222 K" 含 "222"）
		return out.split("\n").some((line) => (line.trim().split(/\s+/)[1] ?? "") === String(pid));
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (e: unknown) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** 整树强杀（Windows taskkill /T /F 带走全部子孙；Unix kill -9 直接目标） */
export function killTree(pid: number, executor: ProcGuardExecutor = defaultExecutor): void {
	if (pid <= 0) return;
	if (process.platform === "win32") {
		executor.run("taskkill", ["/T", "/F", "/PID", String(pid)]);
	} else {
		executor.run("kill", ["-9", String(pid)]);
	}
}

export interface WaitForPidExitOptions {
	timeoutMs?: number;
	intervalMs?: number;
	sleep?: (ms: number) => Promise<void>;
	executor?: ProcGuardExecutor;
}

/**
 * 等待 pid 死透：intervalMs 间隔轮询，timeoutMs 上限。
 * 返回是否确认死透；超时未死透返回 false（由调用方决定树杀兜底）。
 */
export async function waitForPidExit(
	pid: number,
	options: WaitForPidExitOptions = {},
): Promise<boolean> {
	const {
		timeoutMs = 10_000,
		intervalMs = 500,
		sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
		executor = defaultExecutor,
	} = options;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isPidAlive(pid, executor)) return true;
		await sleep(intervalMs);
	}
	return !isPidAlive(pid, executor);
}

/** 超龄清扫默认阈值：24 小时 */
export const STALE_VISIBLE_TASK_DIR_MS = 24 * 60 * 60 * 1000;

/**
 * 扫描 Temp 下超龄的 pi-visible-* 残留目录并删除。
 * 兜底主进程意外退出导致延迟清理回调丢失的残留（定时器随进程消亡）。
 *
 * 超龄锚点：目录内全部条目（含文件）的最大 mtime，不取目录自身 mtime——
 * Windows 文件系统下写文件内容不刷新父目录 mtime，取目录自身会把运行中的
 * 长任务目录（stalled 轮询 5 分钟必然刷新 session.jsonl 的 mtime）误判为超龄。
 * 逐目录容错：单个目录删除失败不中断扫描。
 */
export function sweepStaleVisibleTaskDirs(
	tmpRoot: string = os.tmpdir(),
	maxAgeMs: number = STALE_VISIBLE_TASK_DIR_MS,
): void {
	try {
		const entries = fs.readdirSync(tmpRoot);
		for (const name of entries) {
			if (!name.startsWith("pi-visible-")) continue;
			const dir = path.join(tmpRoot, name);
			try {
				if (!isStaleVisibleTaskDir(dir, maxAgeMs)) continue;
				// 死透检查：主进程崩溃后子代理可能仍活着（罕见但存在）——跳过本轮，下轮 sweep 再试
				const pid = resolvePlatformPid(readProcPid(dir));
				if (pid !== null && isPidAlive(pid)) continue;
				fs.rmSync(dir, { recursive: true, force: true });
			} catch { /* 单目录失败容错 */ }
		}
	} catch { /* 扫描根不可读则跳过 */ }
}

/** 目录内全部条目的最大 mtime 是否超过 maxAgeMs */
function isStaleVisibleTaskDir(dir: string, maxAgeMs: number): boolean {
	try {
		const stat = fs.statSync(dir);
		if (!stat.isDirectory()) return false;
		let newest = stat.mtimeMs;
		for (const entry of fs.readdirSync(dir)) {
			try {
				newest = Math.max(newest, fs.statSync(path.join(dir, entry)).mtimeMs);
			} catch { /* 条目消失则跳过 */ }
		}
		return Date.now() - newest > maxAgeMs;
	} catch {
		return false;
	}
}
