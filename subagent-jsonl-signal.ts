/**
 * visible 模式系统性失败信号：子会话 session.jsonl 终结形态判定
 *
 * visible spawn 的子进程输出直进终端窗格、stderr 无数据源（pipe 拿不到数据），
 * close 分支的失败信号改看 jsonl：文件缺失或无 message 事件（未进入对话阶段）
 * = spawn 层阵亡，判系统性失败档。
 *
 * 注：pi 的 session.jsonl 没有 result/agent_end 类终结事件——正常会话末行
 * 即 message 事件（2026-11 实测多个已终结会话），故「正常终结形态」的实态
 * 信号 = 存在 message 事件（对话确实发生过）。
 */

import * as fs from "node:fs";

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
