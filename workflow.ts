/**
 * workflow: 工作流工具注册
 *
 * registerWorkflowTool 封装了通用工具注册模式：
 * - 从 actions 自动生成 action 枚举
 * - switch 路由到对应 handler
 * - gate 检查（前置门控）
 * - 每次 action 后自动 persist + updateUI
 * - handler 异常时 persist 中间 state 后传播错误
 */

import type { ExtensionAPI, ExtensionContext, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StateManager, UIUpdater } from "./state";

export interface ActionDef<T> {
	description: string;
	handler: (
		params: any,
		state: T,
		ctx: ExtensionContext,
		signal?: AbortSignal,
		onUpdate?: any,
	) => Promise<AgentToolResult<any>>;
	/** 可选的前置门控。返回 {pass:false, reason} 阻止 handler 执行 */
	gate?: (state: T) => { pass: boolean; reason?: string };
}

/**
 * 注册工作流工具。
 *
 * 内部处理：
 * - 参数 schema 生成（从 actions 自动生成 action enum）
 * - switch 路由到对应 action handler
 * - gate 检查
 * - 每次 action 后自动 persist + updateUI
 * - handler 异常时 persist + updateUI 后向上抛
 */
export function registerWorkflowTool<T>(pi: ExtensionAPI, options: {
	name: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	actions: Record<string, ActionDef<T>>;
	stateManager: StateManager<T>;
	uiUpdater: UIUpdater<T>;
	/** 可选的自定义参数 schema 字段，合并到默认的 action+plan_file 之外 */
	extraParams?: Record<string, any>;
}): void {
	const actionNames = Object.keys(options.actions);

	pi.registerTool({
		name: options.name,
		label: options.name,
		description: options.description,
		promptSnippet: options.promptSnippet,
		promptGuidelines: options.promptGuidelines,
		parameters: Type.Object({
			action: Type.Union(actionNames.map(a => Type.Literal(a))),
			plan_file: Type.Optional(Type.String({ description: "方案文件路径（可选，默认用 state 中记录的路径）" })),
			...(options.extraParams || {}),
		}),

		async execute(
			_tcId: string,
			params: any,
			signal: AbortSignal | undefined,
			onUpdate: any,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<any>> {
			const { action, ...actionParams } = params;
			const actionDef = options.actions[action as string];

			if (!actionDef) {
				return {
					content: [{ type: "text" as const, text: `未知 action: "${action}"。可用: ${actionNames.join(", ")}` }],
					details: { error: `unknown_action: ${action}` },
					terminate: false,
				};
			}

			// Gate 检查
			if (actionDef.gate) {
				const gateResult = actionDef.gate(options.stateManager.get());
				if (!gateResult.pass) {
					return {
						content: [{ type: "text" as const, text: `Gate 阻止: ${gateResult.reason}` }],
						details: { error: `gate_blocked: ${gateResult.reason}` },
						terminate: false,
					};
				}
			}

			try {
				const result = await actionDef.handler(
					actionParams,
					options.stateManager.get(),
					ctx,
					signal,
					onUpdate,
				);
				options.stateManager.persist(ctx);
				options.uiUpdater.update(ctx, options.stateManager.get());
				return result;
			} catch (err) {
				// handler 异常时，先 persist 当前中间状态再向上传播
				options.stateManager.persist(ctx);
				options.uiUpdater.update(ctx, options.stateManager.get());
				throw err;
			}
		},
	} as any);
}
