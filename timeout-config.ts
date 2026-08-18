/**
 * 子代理超时配置 — 优先级链单点解析
 *
 * 优先级（低 → 高）：
 *   代码 fallback (30min) < subagent.timeoutMs < subagent.agentTimeouts[name] < 调用方显式传参
 *
 * 配置经 shared-utils getEffectiveConfig() 三层合并：
 *   代码默认 → 全局 ~/.pi/agent/settings.json → 项目 {cwd}/.pi/settings.json
 */

import { getEffectiveConfig } from "@pi-atelier/shared-utils";

/** 超时配置 schema */
export interface SubagentTimeoutConfig {
	/** 全局默认超时（毫秒） */
	timeoutMs: number;
	/** per-agent 超时覆盖（agent 名 → 毫秒） */
	agentTimeouts: Record<string, number>;
}

/** 代码级 fallback：30 分钟 */
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 30 * 60 * 1000;

/** subagent section 超时字段的 schema 默认值（用于三层合并与类型校验） */
export const SUBAGENT_TIMEOUT_DEFAULTS: SubagentTimeoutConfig = {
	timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
	agentTimeouts: {},
};

/**
 * 解析某个 agent 的有效超时。
 *
 * @param agentName agent 名（对应 agents/{name}.md）
 * @param cwd       当前项目目录（用于项目级 .pi/settings.json 覆盖）
 * @param explicit  调用方显式传参（最高优先级，undefined 表示未传）
 */
export function resolveSubagentTimeout(
	agentName: string,
	cwd: string,
	explicit?: number,
): number {
	const { config } = getEffectiveConfig(
		"subagent",
		SUBAGENT_TIMEOUT_DEFAULTS,
		cwd,
	);

	if (explicit !== undefined && explicit > 0) return explicit;
	const perAgent = config.agentTimeouts?.[agentName];
	if (typeof perAgent === "number" && perAgent > 0) return perAgent;
	if (typeof config.timeoutMs === "number" && config.timeoutMs > 0) {
		return config.timeoutMs;
	}
	return DEFAULT_SUBAGENT_TIMEOUT_MS;
}
