/**
 * workflow: barrel export
 *
 * 导出所有公共 API。内部实现细节不导出。
 * 本文件不是 pi 扩展入口，仅为 npm "main" 字段的占位。
 */

export { runSubagent } from "./subagent";
export { loadAgentDef, type AgentDef } from "./agent-loader";
export { createSubagentWidget } from "./widget";
export { saveSubagentOutput, readSubagentOutput } from "./output";
export type { SubagentResult, SubagentEvent } from "./types";
export { createStateManager, createUIUpdater } from "./state";
export { registerWorkflowTool, type ActionDef } from "./workflow";
export { findSessionFile, getSubagentStatusSummary, isSubagentSuccess } from "./utils";

// pi 扩展系统要求 export default function，这不是一个真正的扩展
export default function noop() {}
