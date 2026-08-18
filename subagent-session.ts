/**
 * SubagentSession — 子代理执行生命周期的公共状态管理
 *
 * 封装两种 spawn 模式（visible / once）共享的逻辑：
 * 1. 输出收集（collectTexts + formatOutput）
 * 2. 退出控制（resolved 守卫 + 一次性 resolve）
 * 3. 事件解析（parseStreamEvent / parseSessionLine）
 *
 * resolveOnce 时自动附加捕获到的 subSessionId（供父侧建立会话关联）。
 */

import type { SubagentResult } from "./types";

export class SubagentSession {
	/** 收集到的所有 assistant 文本块 */
	private readonly allTexts: string[] = [];

	/** 捕获到的子代理 session ID */
	capturedSessionId: string | undefined;

	/** 是否已 resolve（退出守卫） */
	private resolved = false;

	/** 外部 resolve 函数（Promise 构造器中赋值） */
	private resolver!: (result: SubagentResult) => void;

	/** 外部 Promise（调用者 await 这个） */
	readonly result: Promise<SubagentResult>;

	/** 实时事件回调 */
	private readonly onEvent?: (event: any) => void;

	/** 退出时的额外处理（如注入父会话） */
	private readonly beforeResolve?: (result: SubagentResult) => void;

	constructor(
		opts: {
			onEvent?: (event: any) => void;
			beforeResolve?: (result: SubagentResult) => void;
		} = {},
	) {
		this.onEvent = opts.onEvent;
		this.beforeResolve = opts.beforeResolve;
		this.result = new Promise<SubagentResult>((resolve) => {
			this.resolver = resolve;
		});
	}

	// ─── 输出收集 ─────────────────────────────────────

	/** 从 LLM message 中提取 assistant text 并收集 */
	collectTexts(message: any): void {
		if (message?.role !== "assistant") return;
		for (const part of message.content ?? []) {
			if (part.type === "text" && part.text.trim()) {
				this.allTexts.push(part.text);
			}
		}
	}

	/** 格式化收集到的输出（去重 + 拼接） */
	formatOutput(fallback: string): string {
		return this.allTexts.length > 0
			? [...new Set(this.allTexts)].join("\n\n---\n\n")
			: fallback;
	}

	// ─── 事件解析 ─────────────────────────────────────

	/** 解析 JSON 事件行（once 模式：来自 stdout 流式 JSON） */
	parseStreamEvent(event: any): void {
		if (event.type === "session" && event.id && !this.capturedSessionId)
			this.capturedSessionId = event.id;
		if (event.type === "tool_execution_start")
			this.onEvent?.({
				type: "tool",
				toolName: event.toolName,
				toolArgs: event.args,
			});
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent?.type === "text_delta"
		)
			this.onEvent?.({
				type: "thinking",
				text: event.assistantMessageEvent.delta,
			});
		if (event.type === "message_end") this.collectTexts(event.message);
		if (event.type === "turn_end") {
			this.collectTexts(event.message);
			this.onEvent?.({ type: "message", message: event.message });
		}
		if (event.type === "agent_end" && Array.isArray(event.messages)) {
			for (const msg of event.messages) this.collectTexts(msg);
		}
	}

	/** 解析 session.jsonl 的一行（visible 模式：来自文件轮询） */
	parseSessionLine(entry: any): void {
		if (entry.type === "session" && entry.id)
			this.capturedSessionId = entry.id;
		if (entry.type === "message" && entry.message)
			this.collectTexts(entry.message);
		if (entry.type === "tool_execution_start")
			this.onEvent?.({
				type: "tool",
				toolName: entry.toolName,
				toolArgs: entry.args,
			});
		if (entry.type === "agent_end" && Array.isArray(entry.messages)) {
			for (const msg of entry.messages) this.collectTexts(msg);
		}
	}

	// ─── 退出控制 ─────────────────────────────────────

	/** 一次性 resolve（防止重复调用，自动附加 subSessionId） */
	resolveOnce(result: SubagentResult): void {
		if (this.resolved) return;
		this.resolved = true;
		if (this.capturedSessionId && result.subSessionId === undefined) {
			result.subSessionId = this.capturedSessionId;
		}
		this.beforeResolve?.(result);
		this.resolver(result);
	}

	/** 当前是否已退出 */
	get isDone(): boolean {
		return this.resolved;
	}
}
