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
import { detectTerminal, getBackend } from "./term-backend";
import type { TermBackend } from "./term-backend";

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

		const cleanup = () => {
			backend.killPane(paneId);
			try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
		};

		// ─── 轮询 session.jsonl ─────────────────

		const pollInterval = setInterval(() => {
			if (agentSession.isDone) return;

			// 读取新行并解析
			try {
				if (fs.existsSync(sessionFile)) {
					const content = fs.readFileSync(sessionFile, "utf-8");
					const lines = content.split("\n").filter((l) => l.trim());
					if (lines.length > lastLine) lastActivityTime = Date.now();
					for (let i = lastLine; i < lines.length; i++) {
						try { agentSession.parseSessionLine(JSON.parse(lines[i])); } catch { /* skip */ }
					}
					lastLine = lines.length;
				}
			} catch { /* ignore */ }

			// 检查 pane 是否存活
			if (!backend.isPaneAlive(paneId)) finish();

			// 活跃超时：5 分钟无新输出视为停滞
			if (Date.now() - lastActivityTime > 5 * 60 * 1000) {
				agentSession.resolveOnce({
					exitCode: 1,
					output: agentSession.formatOutput("(stalled, no output for 5 min)"),
					stderr: "",
					timedOut: true,
				});
				clearInterval(pollInterval);
				clearTimeout(wallTimer);
				cleanup();
			}
		}, 2000);

		// ─── 墙钟超时兜底 ─────────────────────

		const TIMEOUT_MS = timeoutMs ?? 30 * 60 * 1000;
		const wallTimer = setTimeout(() => {
			agentSession.resolveOnce({
				exitCode: 1,
				output: agentSession.formatOutput("(timed out)"),
				stderr: "",
				timedOut: true,
			});
			clearInterval(pollInterval);
			cleanup();
		}, TIMEOUT_MS);

		// ─── 正常结束：收集剩余输出 ────────────

		function finish() {
			if (agentSession.isDone) return;

			try { execSync("sleep 0.5", { stdio: "pipe" }); } catch { /* ignore */ }
			try {
				if (fs.existsSync(sessionFile)) {
					const content = fs.readFileSync(sessionFile, "utf-8");
					const lines = content.split("\n").filter((l) => l.trim());
					for (let i = lastLine; i < lines.length; i++) {
						try { agentSession.parseSessionLine(JSON.parse(lines[i])); } catch { /* skip */ }
					}
				}
			} catch { /* ignore */ }

			agentSession.resolveOnce({
				exitCode: 0,
				output: agentSession.formatOutput("(no output)"),
				stderr: "",
			});
			clearInterval(pollInterval);
			clearTimeout(wallTimer);

			// 延迟清理临时目录（让用户看到最终输出；pane 由自动退出机制自行结束）
			setTimeout(() => {
				try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
			}, 5000);
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
					cleanup();
				}
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		// 将 session.result 连接到外部 resolve
		agentSession.result.then(resolve);
	});
}
