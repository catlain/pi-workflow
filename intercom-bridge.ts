/**
 * pi-intercom 桥接环境变量构建
 *
 * 这些环境变量让 pi-intercom（子代理侧）注册 contact_supervisor 工具。
 * 如果 pi-intercom 未安装，这些环境变量会被安全忽略（零副作用）。
 */

let _childIndex = 0;

/** orchestrator 会话名解析器，由各扩展在扩展入口注册 */
let _orchestratorNameResolver: (() => string | undefined | Promise<string | undefined>) | undefined;

/**
 * 各扩展入口调用：注册 orchestrator 会话名的获取方式
 * （subagent 扩展传 pi.getSessionName；未注册时回退 "orchestrator"）
 */
export function setOrchestratorNameResolver(
	resolver: (() => string | undefined | Promise<string | undefined>) | undefined,
): void {
	_orchestratorNameResolver = resolver;
}

/**
 * 构建 pi-intercom 需要的子代理桥接环境变量（5 个 PI_SUBAGENT_* 变量）。
 *
 * run-id 由时间戳 + 进程内自增序号组成，同一父进程内保证唯一。
 */
export function buildIntercomBridge(
	orchestratorName: string | undefined,
	agentName: string,
): Record<string, string> {
	const idx = ++_childIndex;
	const runId = `run-${Date.now().toString(36)}-${idx.toString(36)}`;
	const target = orchestratorName || "orchestrator";
	return {
		PI_SUBAGENT_ORCHESTRATOR_TARGET: target,
		PI_SUBAGENT_RUN_ID: runId,
		PI_SUBAGENT_CHILD_AGENT: agentName,
		PI_SUBAGENT_CHILD_INDEX: String(idx),
		PI_SUBAGENT_INTERCOM_SESSION_NAME: `${agentName}-${runId}`,
	};
}

/**
 * 解析 orchestrator 会话名（已注册 resolver 则调用，否则 undefined）
 */
export async function resolveOrchestratorName(): Promise<string | undefined> {
	try {
		return await _orchestratorNameResolver?.();
	} catch {
		return undefined;
	}
}
