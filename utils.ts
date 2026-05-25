/**
 * workflow: 子代理通用工具函数
 *
 * findSessionFile / getSubagentStatusSummary / isSubagentSuccess
 * 所有使用 runSubagent 的扩展共享。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * 从 ~/.pi/agent/sessions/ 中找到指定会话 ID 对应的文件路径
 */
export function findSessionFile(sessionId: string): string | undefined {
	const sessionDir = path.join(os.homedir(), ".pi", "agent", "sessions");
	if (!fs.existsSync(sessionDir)) return undefined;

	for (const projectDir of fs.readdirSync(sessionDir)) {
		const projectPath = path.join(sessionDir, projectDir);
		if (!fs.statSync(projectPath).isDirectory()) continue;
		for (const file of fs.readdirSync(projectPath)) {
			if (file.includes(sessionId)) {
				return path.join(projectPath, file);
			}
		}
	}
	return undefined;
}

/**
 * 读取子代理会话的最新状态摘要
 */
export function getSubagentStatusSummary(sessionId: string): string | undefined {
	const filePath = findSessionFile(sessionId);
	if (!filePath) return undefined;
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n").filter(Boolean);

		let msgCount = 0;
		let lastToolName = "";
		let lastTs = "";
		for (const line of lines) {
			try {
				const e = JSON.parse(line);
				if (e.type === "message" && e.message?.role === "assistant") {
					msgCount++;
					lastTs = e.timestamp || lastTs;
					for (const c of e.message.content || []) {
						if (c.type === "toolCall") lastToolName = c.name;
					}
				}
			} catch { /* skip */ }
		}

		const age = lastTs ? `(${lastTs.slice(11, 19)})` : "";
		const toolInfo = lastToolName ? `，最近动作: ${lastToolName}` : "";
		return `${msgCount}条消息${toolInfo} ${age} [${(content.length / 1024).toFixed(0)}KB]`;
	} catch {
		return undefined;
	}
}

/**
 * 判断子代理是否成功执行
 *
 * 成功条件：exitCode=0 且无 error 且未超时，
 * 或者输出足够长（>100字符）且不是空输出且未超时。
 */
export function isSubagentSuccess(result: { exitCode: number; output: string; error?: string; timedOut?: boolean }): boolean {
	if (result.exitCode === 0 && !result.error && !result.timedOut) return true;
	return result.output.length > 100 && result.output !== "(no output)" && !result.timedOut;
}
