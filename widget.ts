/**
 * workflow: 子代理实时活动 Widget
 *
 * 创建子代理的实时活动 Widget，用于在 TUI 中显示子代理运行状态。
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { SubagentEvent } from "./types";

/**
 * 创建子代理的实时活动 Widget。
 * 返回 { onEvent, cleanup }，用于 runSubagent 的回调和完成后清理。
 *
 * 用法:
 *   const widget = createSubagentWidget(ctx, { title: "─ 执行 ─" });
 *   const result = await runSubagent(task, prompt, tools, cwd, signal, model, timeout, widget.onEvent);
 *   widget.cleanup();
 */
export function createSubagentWidget(
	ctx: ExtensionContext,
	options?: {
		title?: string;
		icon?: string;
		maxLines?: number;
	},
) {
	const activityLines: string[] = [];
	let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
	let isThinking = false;
	let thinkingStart = 0;
	let updateTimer: ReturnType<typeof setTimeout> | null = null;

	const title = options?.title ?? "─ 子代理 ─";
	const maxLines = options?.maxLines ?? 4;
	const toolIcon = options?.icon ?? "🔧";

	const scheduleWidgetUpdate = () => {
		if (updateTimer) return;
		updateTimer = setTimeout(() => {
			updateTimer = null;
			ctx.ui.setWidget("subagent-activity", (_tui, theme) => ({
				render: (width?: number) => {
					const maxLineWidth = Math.max(10, (width ?? 80) - 4);
					const recent = activityLines.slice(-maxLines).map(
						line => truncateToWidth(line, maxLineWidth, "...")
					);
					const header = truncateToWidth(
						theme.fg("warning", title),
						maxLineWidth, "..."
					);
					return [header, ...recent];
				},
				invalidate: () => {},
			}));
		}, 300);
	};

	const onEvent = (event: SubagentEvent) => {
		switch (event.type) {
			case "tool": {
				const name = event.toolName || "?";
				const toolLine = `${toolIcon} ${name}`;
				const last = activityLines[activityLines.length - 1];
				if (last && (last.startsWith(toolIcon) || last.startsWith("💭"))) {
					activityLines[activityLines.length - 1] = toolLine;
				} else {
					activityLines.push(toolLine);
				}
				isThinking = false;
				if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
				break;
			}
			case "thinking": {
				if (!isThinking) {
					isThinking = true;
					thinkingStart = Date.now();
					activityLines.push(`💭 思考中...`);
				}
				if (!thinkingTimer) {
					thinkingTimer = setTimeout(() => {
						activityLines[activityLines.length - 1] = `💭 思考中 (${Math.floor((Date.now() - thinkingStart) / 1000)}s)`;
					}, 5000);
				}
				break;
			}
			case "message": {
				isThinking = false;
				if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
				activityLines.push(`💬 正在生成...`);
				break;
			}
		}
		scheduleWidgetUpdate();
	};

	const cleanup = () => {
		if (updateTimer) clearTimeout(updateTimer);
		if (thinkingTimer) clearTimeout(thinkingTimer);
		ctx.ui.setWidget("subagent-activity", undefined);
	};

	return { onEvent, cleanup };
}
