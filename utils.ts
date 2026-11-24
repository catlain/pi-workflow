/**
 * workflow: 子代理通用工具函数
 *
 * findSessionFile / getSubagentStatusSummary / isSubagentSuccess
 * 所有使用 runSubagent 的扩展共享。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SubagentResult } from "./types";

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
 * 系统性失败形态（error 字段 / timedOut / 空占位输出兼 stderr 非空）一律判失败
 * （exit 0 不再单独短路——opsx-subarch-meta-baseline F1 修复，spec: subagent-spawn-runtime）。
 */
export function isSubagentSuccess(result: { exitCode: number; output: string; error?: string; timedOut?: boolean; stderr?: string }): boolean {
	if (isSystemicSubagentFailure(result)) return false;
	if (result.exitCode === 0 && !result.error && !result.timedOut) return true;
	return result.output.length > 100 && result.output !== "(no output)" && !result.timedOut;
}

// ─── 系统性失败分类（F1 修复，spec: subagent-spawn-runtime）─────────────

/**
 * 空占位输出形态文本（spawn 各分支兜底输出的字面量）。
 * 字面量由测试锁死（subagent-failure-classification.test.ts）——
 * 改动任一字面量须同步 spawn 分支与测试，防文本漂移静默破坏分类。
 */
export const EMPTY_OUTPUT_PLACEHOLDERS: readonly string[] = [
	"(no output)",
	"(stalled, no output for 5 min)",
	"(timed out)",
];

/** stderr 尾部透出长度上限（防超长） */
export const STDERR_TAIL_LIMIT = 2000;

/** 判定输出是否为空占位形态：空串/纯空白，或包含任一已知占位字面量（前缀或包含匹配） */
export function isEmptyPlaceholderOutput(output: string): boolean {
	if (output.trim() === "") return true;
	return EMPTY_OUTPUT_PLACEHOLDERS.some((p) => output.includes(p));
}

/**
 * 判定结果是否为系统性失败（spawn 层阵亡，重试无效）。
 * 信号优先级：①error 字段存在；②timedOut 布尔为 true；③空占位输出兼 stderr 非空。
 * 有实质输出时 stderr 不参与判定（噪声不误伤）。
 */
export function isSystemicSubagentFailure(
	result: { output: string; error?: string; timedOut?: boolean; stderr?: string },
): boolean {
	if (result.error) return true;
	if (result.timedOut) return true;
	return isEmptyPlaceholderOutput(result.output) && !!(result.stderr && result.stderr.trim());
}

/**
 * 组装系统性失败档结果：跳过重试后返回的呈现形态。
 * - output = 报错说明 + stderr 尾部（截尾防超长）
 * - error 字段必填（失败档闭合标记，isSubagentSuccess 由此判 false）
 * - exitCode 保持子进程原值（不因判失败而篡改）
 */
export function buildSystemicFailureResult(result: SubagentResult): SubagentResult {
	const reason = result.error
		? result.error
		: result.timedOut
			? "timed out"
			: "empty placeholder output with non-empty stderr";
	const stderrTail = result.stderr.trim() ? result.stderr.slice(-STDERR_TAIL_LIMIT) : "";
	const lines = [`[子代理系统性失败] ${reason}——已跳过自动重试（系统性失败重试无效）。`];
	if (stderrTail) {
		lines.push("", "—— stderr 尾部 ——", stderrTail);
	}
	return { ...result, output: lines.join("\n"), error: result.error || `systemic failure: ${reason}` };
}
