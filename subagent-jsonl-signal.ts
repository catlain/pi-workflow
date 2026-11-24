/**
 * 子代理系统性失败信号：子会话 session.jsonl 终结形态判定（visible / once 两种 spawn 模式共用）
 *
 * visible spawn 的子进程输出直进终端窗格、stderr 无数据源（pipe 拿不到数据）；
 * once spawn 的子进程加载崩溃经 bash 包装时可出现 exitCode=0 且 stderr 空。
 * 两种模式下 close 分支的 exitCode/stderr 判定都会失效，失败信号改看 jsonl：
 * 文件缺失或无 message 事件（未进入对话阶段）= spawn 层阵亡，判系统性失败档。
 *
 * 注：pi 的 session.jsonl 没有 result/agent_end 类终结事件——正常会话末行
 * 即 message 事件（2026-11 实测多个已终结会话），故「正常终结形态」的实态
 * 信号 = 存在 message 事件（对话确实发生过）。
 */

import * as fs from "node:fs";
import { findSessionFileById } from "./subagent-utils";

/** 判定结果：ok=false 时 reason 说明异常形态（拼入系统性失败档报错） */
export interface JsonlTerminationSignal {
	ok: boolean;
	reason: string;
}

/**
 * 判定子会话 session.jsonl 终结形态（visible 模式信号源，替代 stderr）。
 * 由 subagent-spawn-visible.ts 的 finish() 在 close 时调用。
 */
export function checkSessionJsonlTermination(sessionFile: string): JsonlTerminationSignal {
	if (!fs.existsSync(sessionFile)) {
		return { ok: false, reason: "session.jsonl 缺失（子进程未建立会话）" };
	}
	try {
		const content = fs.readFileSync(sessionFile, "utf-8");
		const lines = content.split("\n").filter((l) => l.trim());
		if (lines.length === 0) return { ok: false, reason: "session.jsonl 为空" };
		for (const line of lines) {
			try {
				const e = JSON.parse(line);
				if (e?.type === "message") return { ok: true, reason: "" };
			} catch { /* skip non-JSON */ }
		}
		return { ok: false, reason: "session.jsonl 无 message 事件（未进入对话阶段）" };
	} catch (err) {
		return { ok: false, reason: `session.jsonl 读取失败: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** once 模式交叉校验 error 措辞前缀（runSubagent 据 error 字段归系统性失败档；测试锁字面量） */
const ONCE_CROSS_CHECK_SOURCE = "once 模式信号源=jsonl 交叉校验";

/**
 * once 模式失败信号源：空占位形态下的 jsonl 交叉校验（与 visible 模式信号源对齐）。
 * 由 subagent-spawn-once.ts 的 close 分支在等待尾刷容忍窗后调用：
 * - 无 session 事件 → 子会话未建立，直接判异常（不查文件）
 * - 有 session 事件 → findSessionFileById 定位子会话文件；缺失或终结形态异常 → 判异常
 * - 判定正常 → 返回 undefined（不注入 error，维持现行为）
 *
 * @returns 异常形态返回 error 文案（含 sessionId 与判定原因）；正常返回 undefined
 */
export function crossCheckOnceSessionJsonl(
	capturedSessionId: string | undefined,
	cwd: string,
	exitCode: number | null,
	stderr: string,
): string | undefined {
	const exitInfo = `exitCode=${exitCode ?? 1}，stderr ${stderr.trim() ? "非空" : "空"}——疑似进程加载崩溃经 bash 包装假退出`;
	if (!capturedSessionId) {
		return `${ONCE_CROSS_CHECK_SOURCE}：stdout 无 session 事件，子会话未建立（${exitInfo}，bash 包装退出码不可信）`;
	}
	const sessionFile = findSessionFileById(capturedSessionId, cwd);
	if (!sessionFile) {
		return `${ONCE_CROSS_CHECK_SOURCE}：子会话 ${capturedSessionId} 的 session.jsonl 缺失（session 目录中未找到该会话文件）（${exitInfo}）`;
	}
	const signal = checkSessionJsonlTermination(sessionFile);
	if (signal.ok) return undefined;
	return `${ONCE_CROSS_CHECK_SOURCE}：子会话 ${capturedSessionId} 的 ${signal.reason}（${exitInfo}）`;
}
