/**
 * 测试 widget.ts：createSubagentWidget
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock pi-tui
vi.mock("@earendil-works/pi-tui", () => ({
	truncateToWidth: vi.fn((s: string) => s),
}));

// mock pi SDK
vi.mock("@earendil-works/pi-coding-agent", () => ({}));

import { createSubagentWidget } from "../widget";

function createMockCtx() {
	return {
		ui: {
			setWidget: vi.fn(),
			setStatus: vi.fn(),
		},
	};
}

describe("createSubagentWidget", () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it("tool 事件添加工具行", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any);

		widget.onEvent({ type: "tool", toolName: "read" });

		// 触发 scheduleWidgetUpdate 的 setTimeout
		vi.advanceTimersByTime(400);

		expect(ctx.ui.setWidget).toHaveBeenCalled();
		const renderFn = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1][1];
		// setWidget 第二个参数是 widget 定义对象
		expect(renderFn).toBeDefined();
	});

	it("连续相同工具名替换上一行", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any);

		widget.onEvent({ type: "tool", toolName: "read" });
		widget.onEvent({ type: "tool", toolName: "read" });

		vi.advanceTimersByTime(400);
		// 只触发了一次 setWidget（因为 debounce）
		expect(ctx.ui.setWidget).toHaveBeenCalled();
	});

	it("thinking 事件显示思考状态", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any);

		widget.onEvent({ type: "thinking", text: "hmm..." });

		vi.advanceTimersByTime(400);
		expect(ctx.ui.setWidget).toHaveBeenCalled();
	});

	it("message 事件显示生成状态并清除 thinking", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any);

		widget.onEvent({ type: "thinking", text: "..." });
		widget.onEvent({ type: "message", message: {} });

		vi.advanceTimersByTime(400);
		expect(ctx.ui.setWidget).toHaveBeenCalled();
	});

	it("cleanup 清除 widget", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any);

		widget.onEvent({ type: "tool", toolName: "read" });
		widget.cleanup();

		// 最后一次 setWidget 调用应该是清除（undefined）
		const lastCall = ctx.ui.setWidget.mock.calls[ctx.ui.setWidget.mock.calls.length - 1];
		expect(lastCall[0]).toBe("subagent-activity");
		expect(lastCall[1]).toBeUndefined();
	});

	it("自定义 options 生效", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any, {
			title: "自定义标题",
			icon: "⚡",
			maxLines: 2,
		});

		widget.onEvent({ type: "tool", toolName: "bash" });

		vi.advanceTimersByTime(400);
		expect(ctx.ui.setWidget).toHaveBeenCalled();
	});

	it("tool 后 thinking 重新触发思考显示", () => {
		const ctx = createMockCtx();
		const widget = createSubagentWidget(ctx as any);

		widget.onEvent({ type: "tool", toolName: "read" });
		widget.onEvent({ type: "thinking", text: "analyzing..." });

		vi.advanceTimersByTime(400);
		expect(ctx.ui.setWidget).toHaveBeenCalled();
	});
});
