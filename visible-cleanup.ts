/**
 * visible-cleanup: 可见子代理任务目录的有序安全清理
 *
 * 目录删除永不早于 pane 内进程树死透确认（safe-cleanup-visible-subagent）。
 * 工厂形态便于独立单测清理时序，不依赖整个 spawnVisible。
 */
import * as fs from "node:fs";
import type { TermBackend } from "./term-backend";
import { readProcPid, resolvePlatformPid, waitForPidExit, killTree } from "./proc-guard";

/** 降级延迟：身份文件缺失时的保守删除延迟（秒级，不劣于无确认机制的现状） */
const FALLBACK_DELETE_DELAY_MS = 10_000;

export interface SafeCleanupOptions {
	taskDir: string;
	paneId: string;
	backend: TermBackend;
}

/**
 * 生成有序安全清理函数。
 *
 * kill=true（超时/stalled/abort）：killPane 关 PTY → 等待 proc.pid 对应进程
 * 死透（上限 10s）→ 未死透则 taskkill /T /F 整树强杀 → 删除目录。
 * kill=false（正常结束/pane 消失）：不主动杀，只等死透（上限 10s，超时同样
 * 树杀兜底——防 isPaneAlive 高负载误判导致的存活 pi 写已删文件）→ 删除目录。
 * 身份文件缺失（无法解析出平台适用 pid）→ 降级：kill 场景仍先 killPane，
 * 再延迟 10s 删除（行为不劣于现状，且不抛错中断清理）。
 *
 * 调用方应先 resolveOnce 再触发清理（异步后台执行，延迟不影响结果返回）。
 */
export function createSafeCleanup(options: SafeCleanupOptions): (kill: boolean) => Promise<void> {
	const { taskDir, paneId, backend } = options;

	const rmTaskDir = () => {
		try { fs.rmSync(taskDir, { recursive: true, force: true }); } catch { /* ignore */ }
	};

	return async (kill: boolean): Promise<void> => {
		const pid = resolvePlatformPid(readProcPid(taskDir));
		if (pid === null) {
			if (kill) {
				try { backend.killPane(paneId); } catch { /* ignore */ }
			}
			await new Promise((resolve) => setTimeout(resolve, FALLBACK_DELETE_DELAY_MS));
			rmTaskDir();
			return;
		}
		if (kill) {
			try { backend.killPane(paneId); } catch { /* ignore */ }
		}
		const dead = await waitForPidExit(pid);
		if (!dead) {
			try { killTree(pid); } catch { /* ignore */ }
		}
		rmTaskDir();
	};
}
