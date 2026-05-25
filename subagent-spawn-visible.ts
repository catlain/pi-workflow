/**
 * workflow: 可见模式 spawn 实现
 *
 * spawnVisible — tmux 窗格中启动 pi 子进程，用户可实时观察
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SubagentResult, SubagentEvent } from "./types";
import { spawnOnce } from "./subagent-spawn-once";

/** 关闭 tmux 窗格 */
function closeTmuxPane(paneId: string): void {
	if (!/^%\d+$/.test(paneId)) return;
	try { execFileSync("tmux", ["kill-pane", "-t", paneId], { stdio: "pipe" }); } catch { /* ignore */ }
}

export function spawnVisible(
	task: string,
	cwd: string,
	systemPromptPath: string,
	agentDef: { tools: string[]; model?: string },
	signal?: AbortSignal,
	modelOverride?: string,
	timeoutMs?: number,
	onEvent?: (event: SubagentEvent) => void,
): Promise<SubagentResult> {
	const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-visible-"));
	const taskFile = path.join(taskDir, "task.txt");
	fs.writeFileSync(taskFile, task, { encoding: "utf-8" });

	const sessionFile = path.join(taskDir, "session.jsonl");

	const subagentDonePath = path.join(
		os.homedir(), ".pi/agent/git/github.com/HazAT/pi-interactive-subagents/pi-extension/subagents/subagent-done.ts"
	);

	const modelArg = (modelOverride || agentDef.model) ? ` --model ${modelOverride || agentDef.model}` : "";
	const launchScript = path.join(taskDir, "launch.sh");
	const script = [
		"#!/bin/bash",
		"export FNM_PATH=\"$HOME/.local/share/fnm\"",
		"if [ -d \"$FNM_PATH\" ]; then export PATH=\"$FNM_PATH:$PATH\" && eval \"$(fnm env --shell bash)\"; fi",
		`cd "${cwd}"`,
		"export PI_SUBAGENT_AUTO_EXIT=1",
		`export PI_SUBAGENT_SESSION='${sessionFile}'`,
		`export PI_SUBAGENT_NAME='pv-visible'`,
		`pi --session '${sessionFile}' -e '${subagentDonePath}' --tools ${agentDef.tools.join(",")} --append-system-prompt ${systemPromptPath}${modelArg} @${taskFile}`,
	].join("\n");
	fs.writeFileSync(launchScript, script, { mode: 0o700 });

	let paneId: string;
	try {
		const fromPane = process.env.TMUX_PANE;
		const args = ["split-window", "-h", "-d"];
		if (fromPane) args.push("-t", fromPane);
		args.push("-P", "-F", "#{pane_id}", "bash", launchScript);
		paneId = execFileSync("tmux", args, { encoding: "utf8" }).trim();
	} catch {
		try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
		return spawnOnce(task, cwd, systemPromptPath, agentDef, signal, modelOverride, timeoutMs, onEvent);
	}

	let lastLine = 0;
	let allTexts: string[] = [];
	let capturedSessionId: string | undefined;

	const collectTexts = (message: any) => {
		if (message?.role !== "assistant") return;
		for (const part of message.content ?? []) {
			if (part.type === "text" && part.text.trim()) {
				allTexts.push(part.text);
			}
		}
	};

	return new Promise<SubagentResult>((resolve) => {
		let resolved = false;
		let lastActivityTime = Date.now();

		const pollInterval = setInterval(() => {
			if (resolved) return;

			try {
				if (fs.existsSync(sessionFile)) {
					const content = fs.readFileSync(sessionFile, "utf-8");
					const lines = content.split("\n").filter(l => l.trim());
					if (lines.length > lastLine) lastActivityTime = Date.now();
					for (let i = lastLine; i < lines.length; i++) {
						try {
							const entry = JSON.parse(lines[i]);
							if (entry.type === "session" && entry.id) capturedSessionId = entry.id;
							if (entry.type === "message" && entry.message) collectTexts(entry.message);
							if (entry.type === "tool_execution_start") onEvent?.({ type: "tool", toolName: entry.toolName, toolArgs: entry.args });
							if (entry.type === "agent_end" && Array.isArray(entry.messages)) {
								for (const msg of entry.messages) collectTexts(msg);
							}
						} catch { /* skip */ }
					}
					lastLine = lines.length;
				}
			} catch { /* ignore */ }

			try {
				if (!/^%\d+$/.test(paneId)) { finish(); return; }
				execFileSync("tmux", ["list-panes", "-t", paneId], { stdio: "pipe" });
			} catch {
				finish();
			}

			// 活跃超时：5 分钟无新输出视为停滞
			const STALL_MS = 5 * 60 * 1000;
			if (Date.now() - lastActivityTime > STALL_MS) {
				if (resolved) return;
				resolved = true;
				clearInterval(pollInterval);
				closeTmuxPane(paneId);
				try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
				const output = allTexts.length > 0
					? [...new Set(allTexts)].join("\n\n---\n\n")
					: "(stalled, no output for 5 min)";
				resolve({ exitCode: 1, output, stderr: "", timedOut: true, subSessionId: capturedSessionId });
			}
		}, 2000);

		// 墙钟超时改为兜底（30 分钟绝对上限）
		const TIMEOUT_MS = timeoutMs ?? 30 * 60 * 1000;
		const timer = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			clearInterval(pollInterval);
			closeTmuxPane(paneId);
			try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
			const output = allTexts.length > 0
				? [...new Set(allTexts)].join("\n\n---\n\n")
				: "(timed out)";
			resolve({ exitCode: 1, output, stderr: "", timedOut: true, subSessionId: capturedSessionId });
		}, TIMEOUT_MS);

		function finish() {
			if (resolved) return;
			resolved = true;
			clearInterval(pollInterval);
			clearTimeout(timer);

			try { execFileSync("sleep", ["0.5"], { stdio: "pipe" }); } catch { /* ignore */ }
			try {
				if (fs.existsSync(sessionFile)) {
					const content = fs.readFileSync(sessionFile, "utf-8");
					const lines = content.split("\n").filter(l => l.trim());
					for (let i = lastLine; i < lines.length; i++) {
						try {
							const entry = JSON.parse(lines[i]);
							if (entry.type === "message" && entry.message) collectTexts(entry.message);
							if (entry.type === "agent_end" && Array.isArray(entry.messages)) {
								for (const msg of entry.messages) collectTexts(msg);
							}
						} catch { /* skip */ }
					}
				}
			} catch { /* ignore */ }

			const output = allTexts.length > 0
				? [...new Set(allTexts)].join("\n\n---\n\n")
				: "(no output)";

			setTimeout(() => { try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ } }, 5000);
			resolve({ exitCode: 0, output, stderr: "", subSessionId: capturedSessionId });
		}

		if (signal) {
			const kill = () => {
				if (!resolved) {
					resolved = true;
					clearInterval(pollInterval);
					clearTimeout(timer);
					closeTmuxPane(paneId);
					try { fs.rmSync(taskDir, { recursive: true }); } catch { /* ignore */ }
					resolve({ exitCode: 1, output: allTexts.join("\n\n---\n\n") || "", stderr: "aborted", subSessionId: capturedSessionId });
				}
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});
}
