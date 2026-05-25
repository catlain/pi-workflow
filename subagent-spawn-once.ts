/**
 * workflow: 后台 spawn 实现
 *
 * spawnOnce — 后台模式（pipe stdout，流式解析 JSON）
 */

import { spawn, execSync } from "node:child_process";
import type { SubagentResult, SubagentEvent } from "./types";
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

	return new Promise<SubagentResult>((resolve) => {
		const proc = spawn(pi.command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });

		let stdout = "";
		let stderr = "";
		let allAssistantTexts: string[] = [];
		let processedOffset = 0;
		let resolved = false;
		let capturedSessionId: string | undefined;
		const sessionIdRegex = /\{"type":"session","version":\d+,"id":"([^"]+)"/;

		const collectAssistantTexts = (message: any) => {
			if (message?.role !== "assistant") return;
			for (const part of message.content ?? []) {
				if (part.type === "text" && part.text.trim()) {
					allAssistantTexts.push(part.text);
				}
			}
		};

		const handleEvent = (event: any) => {
			if (event.type === "session" && event.id && !capturedSessionId) capturedSessionId = event.id;
			if (event.type === "tool_execution_start") onEvent?.({ type: "tool", toolName: event.toolName, toolArgs: event.args });
			if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") onEvent?.({ type: "thinking", text: event.assistantMessageEvent.delta });
			if (event.type === "message_end") collectAssistantTexts(event.message);
			if (event.type === "turn_end") { collectAssistantTexts(event.message); onEvent?.({ type: "message", message: event.message }); }
			if (event.type === "agent_end" && Array.isArray(event.messages)) { for (const msg of event.messages) collectAssistantTexts(msg); }
		};

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString();
			const newData = stdout.slice(processedOffset);
			for (const line of newData.split("\n")) {
				if (!line.trim()) continue;
				try { handleEvent(JSON.parse(line)); } catch { /* skip non-JSON */ }
			}
			processedOffset = stdout.lastIndexOf("\n") + 1;
		});

		const checkSessionId = (text: string) => { if (!capturedSessionId) { const m = text.match(sessionIdRegex); if (m) capturedSessionId = m[1]; } };
		const origOnData = proc.stdout.listeners("data").pop();
		if (origOnData) proc.stdout.on("data", (buf: Buffer) => checkSessionId(buf.toString()));

		proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

		// 活跃超时：有新输出就续命
		let lastActivityTime = Date.now();
		const STALL_MS = 5 * 60 * 1000;
		const stallChecker = setInterval(() => {
			if (resolved) { clearInterval(stallChecker); return; }
			if (Date.now() - lastActivityTime > STALL_MS) {
				resolved = true;
				clearTimeout(wallTimer);
				clearInterval(stallChecker);
				proc.kill("SIGTERM");
				setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
				resolve({ exitCode: 1, output: [...new Set(allAssistantTexts)].join("\n\n---\n\n") || "(stalled, no output for 5 min)", stderr, timedOut: true, subSessionId: capturedSessionId });
			}
		}, 5000);

		// 更新活跃时间（在 stdout data handler 里追踪）
		proc.stdout.prependListener("data", () => { lastActivityTime = Date.now(); });

		// 墙钟兜底
		const TIMEOUT_MS = timeoutMs ?? 30 * 60 * 1000;
		const wallTimer = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			clearInterval(stallChecker);
			clearTimeout(wallTimer);
			proc.kill("SIGTERM");
			setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
			resolve({ exitCode: 1, output: [...new Set(allAssistantTexts)].join("\n\n---\n\n") || "(timed out)", stderr, timedOut: true, subSessionId: capturedSessionId });
		}, TIMEOUT_MS);

		proc.on("close", (code) => {
			clearTimeout(wallTimer);
			clearInterval(stallChecker);
			if (resolved) return;
			resolved = true;

			const remaining = stdout.slice(processedOffset);
			for (const line of remaining.split("\n")) {
				if (!line.trim()) continue;
				try { handleEvent(JSON.parse(line)); } catch { /* skip */ }
			}

			resolve({ exitCode: code ?? 1, output: [...new Set(allAssistantTexts)].join("\n\n---\n\n") || "(no output)", stderr, subSessionId: capturedSessionId });
		});

		proc.on("error", (err) => {
			clearTimeout(wallTimer);
			clearInterval(stallChecker);
			if (resolved) return;
			resolved = true;
			resolve({ exitCode: 1, output: allAssistantTexts.join("\n\n---\n\n") || "", stderr: err.message, error: err.message, subSessionId: capturedSessionId });
		});

		if (signal) {
			const kill = () => {
				if (!resolved) {
					resolved = true;
					clearTimeout(wallTimer);
					clearInterval(stallChecker);
					proc.kill("SIGTERM");
					if (capturedSessionId) resolve({ exitCode: 1, output: allAssistantTexts.join("\n\n---\n\n") || "", stderr: "aborted", subSessionId: capturedSessionId });
					setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
				}
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});
}
