/**
 * workflow: 后台 spawn 实现
 *
 * spawnOnce — 后台模式（pipe stdout，流式解析 JSON）
 * 使用 SubagentSession 管理输出收集和退出控制
 */

import { spawn } from "node:child_process";
import { SubagentSession } from "./subagent-session";
import type { SubagentEvent, SubagentResult } from "./types";
import { getPiCommand } from "./subagent-utils";

export function spawnOnce(
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
	const pi = getPiCommand();
	const args = [
		...pi.args,
		"--mode", "json",
		"-p",
		"--tools", agentDef.tools.join(","),
		"--append-system-prompt", systemPromptPath,
	];
	if (modelOverride || agentDef.model) {
		args.push("--model", modelOverride || agentDef.model!);
	}
	args.push(task);

	const session = new SubagentSession({ onEvent });

	return new Promise<SubagentResult>((resolve) => {
		const proc = spawn(pi.command, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
		});

		let stdout = "";
		let stderr = "";
		let processedOffset = 0;
		const sessionIdRegex = /\{"type":"session","version":\d+,"id":"([^"]+)"/;

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
			const newData = stdout.slice(processedOffset);
			for (const line of newData.split("\n")) {
				if (!line.trim()) continue;
				try { session.parseStreamEvent(JSON.parse(line)); } catch { /* skip non-JSON */ }
			}
			processedOffset = stdout.lastIndexOf("\n") + 1;
		});

		// 额外监听：捕获 sessionId（stdout 里可能跨 chunk 断裂）
		const checkSessionId = (text: string) => {
			if (!session.capturedSessionId) {
				const m = text.match(sessionIdRegex);
				if (m) session.capturedSessionId = m[1];
			}
		};
		const origOnData = proc.stdout.listeners("data").pop();
		if (origOnData) proc.stdout.on("data", (buf: Buffer) => checkSessionId(buf.toString()));

		proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

		// ─── 清理辅助 ─────────────────────────────

		const killProc = () => {
			proc.kill("SIGTERM");
			setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
		};

		const clearTimers = () => {
			clearTimeout(wallTimer);
			clearInterval(stallChecker);
		};

		// ─── 计时器 ─────────────────────────────────

		// 活跃超时：有新输出就续命
		let lastActivityTime = Date.now();
		const STALL_MS = 5 * 60 * 1000;
		const stallChecker = setInterval(() => {
			if (session.isDone) { clearInterval(stallChecker); return; }
			if (Date.now() - lastActivityTime > STALL_MS) {
				session.resolveOnce({
					exitCode: 1,
					output: session.formatOutput("(stalled, no output for 5 min)"),
					stderr,
					timedOut: true,
				});
				killProc();
			}
		}, 5000);

		proc.stdout.prependListener("data", () => { lastActivityTime = Date.now(); });

		// 墙钟兜底
		const TIMEOUT_MS = timeoutMs ?? 30 * 60 * 1000;
		const wallTimer = setTimeout(() => {
			session.resolveOnce({
				exitCode: 1,
				output: session.formatOutput("(timed out)"),
				stderr,
				timedOut: true,
			});
			killProc();
		}, TIMEOUT_MS);

		// ─── 进程事件 ─────────────────────────────

		proc.on("close", (code) => {
			clearTimers();
			// 处理剩余未解析的 stdout
			const remaining = stdout.slice(processedOffset);
			for (const line of remaining.split("\n")) {
				if (!line.trim()) continue;
				try { session.parseStreamEvent(JSON.parse(line)); } catch { /* skip */ }
			}
			session.resolveOnce({
				exitCode: code ?? 1,
				output: session.formatOutput("(no output)"),
				stderr,
			});
		});

		proc.on("error", (err) => {
			clearTimers();
			session.resolveOnce({
				exitCode: 1,
				output: session.formatOutput(""),
				stderr: err.message,
				error: err.message,
			});
		});

		// ─── AbortSignal ──────────────────────────

		if (signal) {
			const onAbort = () => {
				if (!session.isDone) {
					session.resolveOnce({
						exitCode: 1,
						output: session.formatOutput(""),
						stderr: "aborted",
					});
					killProc();
				}
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		// 将 session.result 连接到外部 resolve
		session.result.then(resolve);
	});
}
