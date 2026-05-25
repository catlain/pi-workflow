/**
 * workflow: 通用类型定义
 *
 * 只含与业务无关的通用类型。PV 专用类型保留在 plan-verify。
 */

/** 子代理执行结果 */
export interface SubagentResult {
	exitCode: number;
	output: string;
	stderr: string;
	error?: string;
	timedOut?: boolean;
	subSessionId?: string;
}

/** 子代理实时事件，用于转发到父窗口 TUI */
export interface SubagentEvent {
	type: "tool" | "thinking" | "message";
	toolName?: string;
	toolArgs?: any;
	text?: string;
	message?: any;
}
