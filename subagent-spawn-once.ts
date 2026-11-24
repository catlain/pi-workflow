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
import { crossCheckOnceSessionJsonl } from "./subagent-jsonl-signal";

/**
 * 空占位形态下 jsonl 交叉校验前的等待——孤儿进程 jsonl 尾刷容忍窗
 * （与 visible 模式 finish 尾刷同款常数；spec: subagent-spawn-runtime）。
 * 导出仅供测试推进 fake timers 时引用，不进 barrel。
 */
export const JSONL_CROSS_CHECK_DELAY_MS = 500;

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
			const exitCode = code ?? 1;
			const output = session.formatOutput("(no output)");

			// 正常路径（有 assistant 文本）零变化：立即返回，不等待、不交叉校验。
			// 触发条件取「未收集到任何文本」而非 isEmptyPlaceholderOutput 的包含匹配，
			// 避免正文里恰好含占位字面量的真实输出被误判。
			if (session.formatOutput("").trim() !== "") {
				session.resolveOnce({ exitCode, output, stderr });
				return;
			}

			// 空占位形态 → once 模式信号源=jsonl 交叉校验（spec: subagent-spawn-runtime）。
			// 先等 JSONL_CROSS_CHECK_DELAY_MS（bash 异常退出时 pi 孤儿进程尚在跑、jsonl 未刷盘的窗口），
			// 再按 capturedSessionId 定位子会话文件判定；注入 error 后由 runSubagent 归系统性失败档（不重试）。
			setTimeout(() => {
				if (session.isDone) return; // 等待窗内已被 abort / 超时先行 resolve
				session.resolveOnce({
					exitCode,
					output,
					stderr,
					error: crossCheckOnceSessionJsonl(session.capturedSessionId, cwd, code, stderr),
				});
			}, JSONL_CROSS_CHECK_DELAY_MS);
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
