/**
 * workflow: 可见模式 spawn 实现
 *
 * spawnVisible — 在终端分屏中启动 pi 子进程，用户可实时观察
 * 支持 WezTerm（优先）和 tmux，都不可用时降级到后台模式
 * 使用 SubagentSession 管理输出收集和退出控制
 *
 * 自动退出机制：launch.sh 注入 PI_SUBAGENT_AUTO_EXIT=1，
 * 子代理进程内由 pi-workflow 扩展入口的 agent_end handler
 * 延迟退出（让 TUI 渲染末尾输出并完成 session.jsonl 刷盘）。
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import type { SubagentEvent, SubagentResult } from "./types";
import { spawnOnce } from "./subagent-spawn-once";
import { SubagentSession } from "./subagent-session";
import { createVisibleTaskDir, injectParentSession } from "./subagent-utils";
import { checkSessionJsonlTermination } from "./subagent-jsonl-signal";
import { detectTerminal, getBackend } from "./term-backend";
import type { TermBackend } from "./term-backend";
import { createSafeCleanup } from "./visible-cleanup";
import { DEFAULT_SUBAGENT_TIMEOUT_MS } from "./timeout-config";

/** 活跃超时：无新输出视为停滞的阈值（与 subagent-spawn-once 的 STALL_MS 语义对齐） */
const STALL_TIMEOUT_MS = 5 * 60 * 1000;

export function spawnVisible(
	task: string,
	cwd: string,
	systemPromptPath: string,
	agentDef: { tools: string[]; model?: string },
	signal?: AbortSignal,
	modelOverride?: string,
	timeoutMs?: number,
	onEvent?: (event: SubagentEvent) => void,
	parentSessionPath?: string,
	extraEnv?: Record<string, string>,
): Promise<SubagentResult> {
	const { taskDir, sessionFile, launchScript } = createVisibleTaskDir(
		task, cwd, systemPromptPath, agentDef, modelOverride, extraEnv,
	);

	// 检测终端类型，不可用则降级到后台模式
	const termType = detectTerminal();
	if (!termType) {
		try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
		return spawnOnce(
			task, cwd, systemPromptPath, agentDef,
			signal, modelOverride, timeoutMs, onEvent, parentSessionPath, extraEnv,
		);
	}

	const backend: TermBackend = getBackend(termType);
	let paneId: string;
	try {
		paneId = backend.splitPane(cwd, launchScript);
	} catch {
		try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
		return spawnOnce(
			task, cwd, systemPromptPath, agentDef,
			signal, modelOverride, timeoutMs, onEvent, parentSessionPath, extraEnv,
		);
	}

	// ─── SubagentSession 管理输出收集和退出 ─────────

	const agentSession = new SubagentSession({
		onEvent,
		beforeResolve: (result) => {
			if (parentSessionPath && fs.existsSync(sessionFile)) {
				injectParentSession(sessionFile, parentSessionPath);
			}
		},
	});

	return new Promise<SubagentResult>((resolve) => {
		let lastLine = 0;
		let lastActivityTime = Date.now();

		// 有序安全清理：目录删除永不早于 pane 内进程树死透确认（实现见 visible-cleanup.ts）
		const safeCleanup = createSafeCleanup({ taskDir, paneId, backend });

		// ─── 轮询 session.jsonl ─────────────────

		const pollInterval = setInterval(() => {
			if (agentSession.isDone) return;

			// 读取新行并解析（半行不推进：写侧未写完的行留给下一轮重读，防止行丢失）
			try {
				if (fs.existsSync(sessionFile)) {
					const content = fs.readFileSync(sessionFile, "utf-8");
					const lines = content.split("\n").filter((l) => l.trim());
					const completeCount = content.endsWith("\n") ? lines.length : Math.max(0, lines.length - 1);
					if (completeCount > lastLine) lastActivityTime = Date.now();
					for (let i = lastLine; i < completeCount; i++) {
						try { agentSession.parseSessionLine(JSON.parse(lines[i])); } catch { /* skip */ }
					}
					lastLine = completeCount;
				}
			} catch { /* ignore */ }

			// 检查 pane 是否存活
			if (!backend.isPaneAlive(paneId)) void finish();

			// 活跃超时：STALL_TIMEOUT_MS 无新输出视为停滞
			if (Date.now() - lastActivityTime > STALL_TIMEOUT_MS) {
				agentSession.resolveOnce({
					exitCode: 1,
					output: agentSession.formatOutput(`(stalled, no output for ${Math.round(STALL_TIMEOUT_MS / 60000)} min)`),
					stderr: "",
					timedOut: true,
				});
				clearInterval(pollInterval);
				clearTimeout(wallTimer);
				void safeCleanup(true);
			}
		}, 2000);

		// ─── 墙钟超时兜底 ─────────────────────

		const TIMEOUT_MS = timeoutMs ?? DEFAULT_SUBAGENT_TIMEOUT_MS;
		const wallTimer = setTimeout(() => {
			agentSession.resolveOnce({
				exitCode: 1,
				output: agentSession.formatOutput("(timed out)"),
				stderr: "",
				timedOut: true,
			});
			clearInterval(pollInterval);
			void safeCleanup(true);
		}, TIMEOUT_MS);

		// ─── 正常结束：收集剩余输出 ────────────

		async function finish() {
			if (agentSession.isDone) return;

			// 等子代理尾部刷盘（跨平台：sleep 命令在非 MSYS2 环境不可用）
			await new Promise((r) => setTimeout(r, 500));
			try {
				if (fs.existsSync(sessionFile)) {
					const content = fs.readFileSync(sessionFile, "utf-8");
					const lines = content.split("\n").filter((l) => l.trim());
					const completeCount = content.endsWith("\n") ? lines.length : Math.max(0, lines.length - 1);
					for (let i = lastLine; i < completeCount; i++) {
						try { agentSession.parseSessionLine(JSON.parse(lines[i])); } catch { /* skip */ }
					}
				}
			} catch { /* ignore */ }

			// visible 模式失败信号源：jsonl 终结形态（stderr 无数据源，见 checkSessionJsonlTermination 注释）。
			// 异常时 error 注入信号源说明，由 runSubagent 分类为系统性失败档（跳过重试+报错透出）；
			// jsonl 正常终结但输出空 → 不注入，回落现状路径（正常完成零输出档）。
			const jsonlSignal = checkSessionJsonlTermination(sessionFile);
			agentSession.resolveOnce({
				exitCode: 0,
				output: agentSession.formatOutput("(no output)"),
				stderr: "",
				error: jsonlSignal.ok ? undefined : `visible 模式信号源=jsonl 终结形态：${jsonlSignal.reason}`,
			});
			clearInterval(pollInterval);
			clearTimeout(wallTimer);

			// 有序清理临时目录（等 pane 内进程死透后删除；pane 由自动退出机制自行结束，
			// 死透等待期间用户仍可看到最终输出）
			void safeCleanup(false);
		}

		// ─── AbortSignal ──────────────────────

		if (signal) {
			const onAbort = () => {
				if (!agentSession.isDone) {
					agentSession.resolveOnce({
						exitCode: 1,
						output: agentSession.formatOutput(""),
						stderr: "aborted",
					});
					clearInterval(pollInterval);
					clearTimeout(wallTimer);
					void safeCleanup(true);
				}
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		// 将 session.result 连接到外部 resolve
		agentSession.result.then(resolve);
	});
}
