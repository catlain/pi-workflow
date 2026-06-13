/**
 * workflow: barrel export
 *
 * 导出所有公共 API。内部实现细节不导出。
 * 本文件不是 pi 扩展入口，仅为 npm "main" 字段的占位。
 */

export { runSubagent, setSessionFileResolver } from "./subagent";
export { type AgentDef, loadAgentDef } from "@pi-atelier/shared-utils";
export { createSubagentWidget } from "./widget";
export { saveSubagentOutput, readSubagentOutput } from "./output";
export type { SubagentResult, SubagentEvent } from "./types";
export { createStateManager, createUIUpdater } from "./state";
export { registerWorkflowTool, type ActionDef } from "./workflow";
export { findSessionFile, getSubagentStatusSummary, isSubagentSuccess } from "./utils";
export { discoverAgents, getAgentDescription } from "./agents";
export { AGENT_DIR, AGENTS_DIR } from "./paths";

// Research module
export type {
	Article,
	ArticleAnalysis as ArticleAnalysisType,
	Direction,
	TopicResearchState,
} from "./research-types";
export {
	slugify,
	urlToId,
	parseFrontmatter,
	getTimestamp,
	getResearchDir,
	getDirectionsDir,
	getTopicDir,
} from "./research-utils";
export {
	loadCatalog,
	saveCatalog,
} from "./research-catalog";
export {
	loadTopicState,
	saveTopicState,
	loadDirectionState,
	saveDirectionState,
} from "./research-state";
export {
	loadAnalysis,
	saveAnalysis,
	defaultAnalysis,
	type ArticleAnalysis,
	type AnalysisState,
} from "./research-analysis";
export {
	scanNewSources,
	scanTopicArticles,
} from "./research-scan";

// pi 扩展系统要求 export default function，这不是一个真正的扩展
export default function noop() {}
