/**
 * workflow: barrel export + 运行时扩展入口
 *
 * 导出所有公共 API。内部实现细节不导出。
 * 默认导出是 pi 扩展入口（全局加载）：注册可见模式子代理自动退出 +
 * intercom 桥接的 orchestrator 会话名解析器。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setOrchestratorNameResolver } from "./intercom-bridge";
import { restoreSubagentModel } from "./subagent-model";

export { runSubagent, setSessionFileResolver } from "./subagent";
export { type OutputConstraint } from "./subagent";
export { type AgentDef, loadAgentDef } from "@pi-atelier/shared-utils";
export { spawnOnce } from "./subagent-spawn-once";
export { spawnVisible } from "./subagent-spawn-visible";
export { SubagentSession } from "./subagent-session";
export { detectTerminal, getBackend, type TermBackend } from "./term-backend";
export { resolveSubagentTimeout, DEFAULT_SUBAGENT_TIMEOUT_MS } from "./timeout-config";
export { buildIntercomBridge, setOrchestratorNameResolver, resolveOrchestratorName } from "./intercom-bridge";
export {
	getSubagentModel,
	setSubagentModel,
	isSubagentModelRestored,
	setSubagentModelRestored,
	restoreSubagentModel,
} from "./subagent-model";
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

// pi 扩展入口：每个 pi 进程（含子代理进程）都会加载
export default function workflowExtension(pi: ExtensionAPI) {
	// 可见模式子代理自动退出：launch.sh 注入 PI_SUBAGENT_AUTO_EXIT=1 后，
	// 子代理 agent_end 后延迟退出（让 TUI 渲染末尾输出并刷盘 session.jsonl）
	pi.on("agent_end", () => {
		if (process.env.PI_SUBAGENT_AUTO_EXIT === "1") {
			setTimeout(() => process.exit(0), 800);
		}
	});

	// intercom 桥接：注册 orchestrator 会话名解析器（contact_supervisor 路由用）
	setOrchestratorNameResolver(() => {
		try {
			return pi.getSessionName();
		} catch {
			return undefined;
		}
	});

	// 恢复子代理默认模型（settings.json subagent.defaultModel）
	restoreSubagentModel();
}
