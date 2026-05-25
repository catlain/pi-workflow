/**
 * workflow: 子代理执行器公开 API
 *
 * spawn 实现在 subagent-spawn-once.ts 和 subagent-spawn-visible.ts。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SubagentResult, SubagentEvent } from "./types";
import { writeTempPrompt } from "./subagent-utils";
import { loadAgentDef } from "./agent-loader";
import { spawnOnce } from "./subagent-spawn-once";
import { spawnVisible } from "./subagent-spawn-visible";

/** 格式约束，拼入 task 让子代理自检，执行后验证 */
export interface OutputConstraint {
	/** 约束描述（自然语言，拼入 task） */
	rule: string;
	/** 验证函数：返回 null 表示通过，否则返回错误描述 */
	validate: (output: string) => string | null;
}

/** 构建格式约束追加提示词 */
function buildConstraintAppendix(constraints: OutputConstraint[]): string {
	const rules = constraints.map((c, i) => `${i + 1}. ${c.rule}`).join("\n");
	return `\n\n---\n\n## 输出格式约束（严格遵守）\n\n你的输出会被自动化系统解析，必须严格遵守以下格式规则：\n\n${rules}\n\n**在输出审查结果之前，先检查你的输出是否符合上述所有规则。如果不符合，修正后再输出。**`;
}

/** 验证输出是否满足所有约束，返回不通过的列表 */
export function validateOutputConstraints(output: string, constraints: OutputConstraint[]): string[] {
	const violations: string[] = [];
	for (const c of constraints) {
		const err = c.validate(output);
		if (err) violations.push(err);
	}
	return violations;
}

/**
 * 运行子代理。支持输出格式约束：约束拼入 task，执行后验证，
 * 不通过则追加修正提示重跑（最多 2 次）。
 *
 * @param agentName 对应 ~/.pi/agent/agents/{name}.md
 * @param visible   true=在 tmux 窗格中可见运行（默认），false=后台运行
 */
export async function runSubagent(
	agentName: string,
	task: string,
	cwd: string,
	signal?: AbortSignal,
	modelOverride?: string,
	timeoutMs?: number,
	onEvent?: (event: SubagentEvent) => void,
	outputConstraints?: OutputConstraint[],
	visible: boolean = true,
): Promise<SubagentResult> {
	const agentDef = loadAgentDef(agentName);
	if (!agentDef) {
		throw new Error(`子代理定义 "${agentName}" 未找到。请确保 ~/.pi/agent/agents/${agentName}.md 文件存在。`);
	}

	const useVisible = visible && !!process.env.TMUX;

	const tmpPromptPath = await writeTempPrompt(agentDef.systemPrompt);

	try {
		const constraintAppendix = outputConstraints?.length ? buildConstraintAppendix(outputConstraints) : "";
		const fullTask = task + constraintAppendix;

		const MAX_RETRIES = 2;
		let lastResult: SubagentResult | undefined;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			const taskForAttempt = attempt === 0 ? fullTask
				: `${fullTask}\n\n---\n\n⚠️ 你上一轮的输出不符合格式约束：\n${validateOutputConstraints(lastResult!.output, outputConstraints!).join("\n")}\n\n请修正格式后重新输出完整的审查结果。不要重复工具调用，直接输出修正后的文本。`;

			const result = useVisible
				? await spawnVisible(taskForAttempt, cwd, tmpPromptPath, agentDef, signal, modelOverride, timeoutMs, onEvent)
				: await spawnOnce(taskForAttempt, cwd, tmpPromptPath, agentDef, signal, modelOverride, timeoutMs, onEvent);
			lastResult = result;

			if (!outputConstraints?.length) break;
			if (result.exitCode !== 0 && result.output.length <= 100) break;

			const violations = validateOutputConstraints(result.output, outputConstraints);
			if (violations.length === 0) break;
		}

		return lastResult!;
	} finally {
		try { const dir = path.dirname(tmpPromptPath); fs.unlinkSync(tmpPromptPath); fs.rmdirSync(dir); } catch { /* ignore */ }
	}
}
