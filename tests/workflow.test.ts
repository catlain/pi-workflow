/**
 * 测试 workflow.ts：registerWorkflowTool
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock typebox
vi.mock("@sinclair/typebox", () => ({
	Type: {
		Object: vi.fn((obj: any) => obj),
		Union: vi.fn((arr: any[]) => arr),
		Literal: vi.fn((val: string) => val),
		Optional: vi.fn((val: any) => val),
		String: vi.fn((opts?: any) => ({ type: "string", ...opts })),
	},
}));

// mock pi SDK
vi.mock("@earendil-works/pi-coding-agent", () => ({}));

import { registerWorkflowTool } from "../workflow";

function createMockPi() {
	let registeredTool: any = null;
	return {
		registerTool: vi.fn((tool: any) => { registeredTool = tool; }),
		getRegisteredTool: () => registeredTool,
	};
}

function createMockStateManager<T>(initialState: T) {
	let state = initialState;
	return {
		get: vi.fn(() => state),
		set: vi.fn((s: T) => { state = s; }),
		reset: vi.fn(),
		persist: vi.fn(),
		restore: vi.fn(),
	};
}

function createMockUIUpdater<T>() {
	return {
		update: vi.fn(),
		clear: vi.fn(),
	};
}

function createMockCtx() {
	return {} as any;
}

describe("registerWorkflowTool", () => {
	it("注册工具并传入正确参数", () => {
		const pi = createMockPi();
		const sm = createMockStateManager({ phase: "idle" });
		const ui = createMockUIUpdater();

		registerWorkflowTool(pi as any, {
			name: "test-tool",
			description: "测试工具",
			actions: {
				start: {
					description: "开始",
					handler: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "started" }], terminate: false }),
				},
			},
			stateManager: sm as any,
			uiUpdater: ui as any,
		});

		expect(pi.registerTool).toHaveBeenCalledOnce();
		const tool = pi.getRegisteredTool();
		expect(tool.name).toBe("test-tool");
		expect(tool.description).toBe("测试工具");
	});

	it("执行已知 action 时调用 handler 并 persist", async () => {
		const pi = createMockPi();
		const sm = createMockStateManager({ phase: "idle" });
		const ui = createMockUIUpdater();
		const handler = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "done" }],
			details: {},
			terminate: false,
		});

		registerWorkflowTool(pi as any, {
			name: "test-tool",
			description: "测试",
			actions: {
				run: { description: "执行", handler },
			},
			stateManager: sm as any,
			uiUpdater: ui as any,
		});

		const tool = pi.getRegisteredTool();
		const result = await tool.execute("tc1", { action: "run" }, undefined, undefined, createMockCtx());

		expect(handler).toHaveBeenCalledOnce();
		expect(sm.persist).toHaveBeenCalled();
		expect(ui.update).toHaveBeenCalled();
		expect(result.content[0].text).toBe("done");
	});

	it("执行未知 action 时返回错误", async () => {
		const pi = createMockPi();
		const sm = createMockStateManager({ phase: "idle" });
		const ui = createMockUIUpdater();

		registerWorkflowTool(pi as any, {
			name: "test-tool",
			description: "测试",
			actions: {
				start: {
					description: "开始",
					handler: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], terminate: false }),
				},
			},
			stateManager: sm as any,
			uiUpdater: ui as any,
		});

		const tool = pi.getRegisteredTool();
		const result = await tool.execute("tc1", { action: "unknown" }, undefined, undefined, createMockCtx());

		expect(result.content[0].text).toContain("未知 action");
		expect(result.details.error).toContain("unknown_action");
	});

	it("gate 阻止时返回 gate_blocked", async () => {
		const pi = createMockPi();
		const sm = createMockStateManager({ phase: "busy" });
		const ui = createMockUIUpdater();

		registerWorkflowTool(pi as any, {
			name: "test-tool",
			description: "测试",
			actions: {
				start: {
					description: "开始",
					handler: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], terminate: false }),
					gate: (state: any) => state.phase === "busy" ? { pass: false, reason: "正在运行" } : { pass: true },
				},
			},
			stateManager: sm as any,
			uiUpdater: ui as any,
		});

		const tool = pi.getRegisteredTool();
		const result = await tool.execute("tc1", { action: "start" }, undefined, undefined, createMockCtx());

		expect(result.content[0].text).toContain("Gate 阻止");
		expect(result.details.error).toContain("gate_blocked");
	});

	it("handler 抛异常时 persist 后向上传播", async () => {
		const pi = createMockPi();
		const sm = createMockStateManager({ phase: "idle" });
		const ui = createMockUIUpdater();

		registerWorkflowTool(pi as any, {
			name: "test-tool",
			description: "测试",
			actions: {
				fail: {
					description: "失败",
					handler: vi.fn().mockRejectedValue(new Error("handler error")),
				},
			},
			stateManager: sm as any,
			uiUpdater: ui as any,
		});

		const tool = pi.getRegisteredTool();
		await expect(tool.execute("tc1", { action: "fail" }, undefined, undefined, createMockCtx()))
			.rejects.toThrow("handler error");

		// 即使异常也要 persist
		expect(sm.persist).toHaveBeenCalled();
		expect(ui.update).toHaveBeenCalled();
	});

	it("gate 通过时正常执行", async () => {
		const pi = createMockPi();
		const sm = createMockStateManager({ phase: "idle" });
		const ui = createMockUIUpdater();

		registerWorkflowTool(pi as any, {
			name: "test-tool",
			description: "测试",
			actions: {
				start: {
					description: "开始",
					handler: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }], terminate: false }),
					gate: () => ({ pass: true }),
				},
			},
			stateManager: sm as any,
			uiUpdater: ui as any,
		});

		const tool = pi.getRegisteredTool();
		const result = await tool.execute("tc1", { action: "start" }, undefined, undefined, createMockCtx());
		expect(result.content[0].text).toBe("ok");
	});
});
