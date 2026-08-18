/**
 * 子代理默认模型管理
 *
 * 持久化到 settings.json 的 subagent.defaultModel 字段。
 * 读取：getEffectiveConfig 三层合并（代码默认 → 全局 → 项目级）
 * 写入：patchSettingsSectionWithBackup 带锁路径（禁止裸 readFileSync/writeFileSync）
 * 未配置时使用主模型（settings.json 的 defaultProvider/defaultModel 组合）。
 */

import {
	getEffectiveConfig,
	getSettingsValue,
	patchSettingsSectionWithBackup,
} from "@pi-atelier/shared-utils";

/** subagent section 模型字段的 schema 默认值 */
const SUBAGENT_MODEL_DEFAULTS = {
	defaultModel: "",
};

let subagentModel = "";
let subagentModelRestored = false;

/**
 * 读取子代理默认模型。
 * subagent.defaultModel 未配置时，回退 defaultProvider/defaultModel 组合。
 */
function readModelFromSettings(cwd?: string): string {
	try {
		const { config } = getEffectiveConfig(
			"subagent",
			SUBAGENT_MODEL_DEFAULTS,
			cwd || process.cwd(),
		);
		if (config.defaultModel) return config.defaultModel;
		// 未配置子代理模型：组合 provider/model（读全局 settings）
		const provider = getSettingsValue<string>("defaultProvider", "");
		const model = getSettingsValue<string>("defaultModel", "");
		if (provider && model) return `${provider}/${model}`;
		return model;
	} catch {
		return "";
	}
}

/**
 * 将子代理模型写入 settings.json 的 subagent.defaultModel（带锁 + 备份）
 */
function persistModelToSettings(model: string): void {
	try {
		patchSettingsSectionWithBackup(
			"subagent",
			{ defaultModel: model },
			SUBAGENT_MODEL_DEFAULTS,
		);
	} catch {
		// 写入失败不阻塞主流程
	}
}

export function getSubagentModel(): string {
	return subagentModel;
}

export function setSubagentModel(model: string, cwd?: string): void {
	subagentModel = model;
	persistModelToSettings(model);
}

export function isSubagentModelRestored(): boolean {
	return subagentModelRestored;
}

export function setSubagentModelRestored(v: boolean): void {
	subagentModelRestored = v;
}

/** 从 settings.json 恢复模型设置（session_start 时调用） */
export function restoreSubagentModel(cwd?: string): void {
	subagentModel = readModelFromSettings(cwd);
	subagentModelRestored = true;
}
