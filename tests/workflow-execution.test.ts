/**
 * Tests: workflow.ts — registerWorkflowTool action 执行
 *
 * 测试场景（5 用例）：
 * 1) 匹配的 action 调用对应 handler
 * 2) handler 执行后自动 persist + updateUI
 * 3) handler 抛异常时 persist 后向上传播
 * 4) 多个 action 按调用顺序执行
 * 5) handler A 修改 state → handler B 可见
 */

import { describe, it, expect, vi } from "vitest";
import type { ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { createMockContext } from "./test-helpers";

// ============================================================
// Types
// ============================================================

interface ActionDef<T> {
	description: string;
	handler: (params: any, state: T, ctx: ExtensionContext, signal?: AbortSignal, onUpdate?: any) => Promise<AgentToolResult<any>>;
	gate?: (state: T) => { pass: boolean; reason?: string };
}
interface StateManager<T> { get(): T; set(s: T): void; reset(): void; persist(ctx: ExtensionContext): void; restore(ctx: ExtensionContext): void }
interface UIUpdater<T> { update(ctx: ExtensionContext, state: T): void; clear(ctx: ExtensionContext): void }

// ============================================================
// Inline implementation (same as workflow-registration.test.ts)
// ============================================================

function registerWorkflowTool<T>(pi: ExtensionAPI, options: {
	name: string; description: string; promptSnippet?: string; promptGuidelines?: string[];
	actions: Record<string, ActionDef<T>>; stateManager: StateManager<T>; uiUpdater: UIUpdater<T>;
}): void {
	const actionNames = Object.keys(options.actions);
	pi.registerTool({
		name: options.name, label: options.name, description: options.description,
		parameters: { type: "object", properties: { action: { type: "string", enum: actionNames } }, required: ["action"] },
		execute: async (_tcId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: ExtensionContext): Promise<AgentToolResult<any>> => {
			const { action, ...actionParams } = params;
			const actionDef = options.actions[action as string];
			if (!actionDef) return { content: [{ type: "text" as const, text: `未知 action: "${action}"` }], details: { error: `unknown_action: ${action}` }, terminate: false };
			if (actionDef.gate) {
				const g = actionDef.gate(options.stateManager.get());
				if (!g.pass) return { content: [{ type: "text" as const, text: `Gate 阻止: ${g.reason}` }], details: { error: `gate_blocked: ${g.reason}` }, terminate: false };
			}
			try {
				const r = await actionDef.handler(actionParams, options.stateManager.get(), ctx, signal, onUpdate);
				options.stateManager.persist(ctx);
				options.uiUpdater.update(ctx, options.stateManager.get());
				return r;
			} catch (err) {
				options.stateManager.persist(ctx);
				options.uiUpdater.update(ctx, options.stateManager.get());
				throw err;
			}
		},
	} as any);
}

// ============================================================
// Fixtures
// ============================================================

interface TestState { phase: string; items: string[]; round: number }
const INITIAL: TestState = { phase: "idle", items: [], round: 0 };

function mockSM(): StateManager<TestState> {
	let s: TestState = { ...INITIAL };
	return { get: vi.fn(() => s), set: vi.fn((v: TestState) => { s = v; }), reset: vi.fn(() => { s = { ...INITIAL }; }), persist: vi.fn(), restore: vi.fn() };
}
function mockUI(): UIUpdater<TestState> { return { update: vi.fn(), clear: vi.fn() }; }
function mockAPI(): ExtensionAPI {
	return { on: vi.fn(), registerTool: vi.fn(), registerCommand: vi.fn(), registerShortcut: vi.fn(), registerFlag: vi.fn(), getFlag: vi.fn(), registerMessageRenderer: vi.fn(), sendMessage: vi.fn(), sendUserMessage: vi.fn(), appendEntry: vi.fn(), setSessionName: vi.fn(), getSessionName: vi.fn(), setLabel: vi.fn(), getActiveTools: vi.fn().mockReturnValue([]), getAllTools: vi.fn().mockReturnValue([]), setActiveTools: vi.fn(), refreshTools: vi.fn(), getCommands: vi.fn().mockReturnValue([]), setModel: vi.fn(), getThinkingLevel: vi.fn(), setThinkingLevel: vi.fn(), exec: vi.fn() } as any;
}

// ============================================================
// Tests: action 路由
// ============================================================

describe("registerWorkflowTool — action 路由", () => {
	it("匹配的 action 调用对应 handler，传递正确的 params", async () => {
		const api = mockAPI();
		const sm = mockSM();
		const ui = mockUI();
		const planHandler = vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: "plan ok" }], details: {} });
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { plan: { description: "plan", handler: planHandler }, execute: { description: "exec", handler: vi.fn() } }, stateManager: sm, uiUpdater: ui });
		const def = (api.registerTool as any).mock.calls[0][0];
		const ctx = createMockContext();
		const r = await def.execute("c1", { action: "plan", task: "test" }, undefined, undefined, ctx);
		expect(planHandler).toHaveBeenCalledWith({ task: "test" }, sm.get(), ctx, undefined, undefined);
		expect(r).toEqual({ content: [{ type: "text", text: "plan ok" }], details: {} });
	});
});

// ============================================================
// Tests: 自动 persist + UI 更新
// ============================================================

describe("registerWorkflowTool — 自动 persist + UI 更新", () => {
	const handler = () => Promise.resolve({ content: [{ type: "text" as const, text: "ok" }], details: {} });

	it("handler 执行后自动 persist + updateUI", async () => {
		const api = mockAPI();
		const sm = mockSM();
		const ui = mockUI();
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { plan: { description: "plan", handler } }, stateManager: sm, uiUpdater: ui });
		const def = (api.registerTool as any).mock.calls[0][0];
		await def.execute("c1", { action: "plan" }, undefined, undefined, createMockContext());
		expect(sm.persist).toHaveBeenCalledTimes(1);
		expect(ui.update).toHaveBeenCalledTimes(1);
	});

	it("handler 抛异常时 persist + updateUI，然后传播错误", async () => {
		const api = mockAPI();
		const sm = mockSM();
		const ui = mockUI();
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { plan: { description: "plan", handler: () => Promise.reject(new Error("写入失败")) } }, stateManager: sm, uiUpdater: ui });
		const def = (api.registerTool as any).mock.calls[0][0];
		await expect(def.execute("c1", { action: "plan" }, undefined, undefined, createMockContext())).rejects.toThrow("写入失败");
		expect(sm.persist).toHaveBeenCalledTimes(1);
		expect(ui.update).toHaveBeenCalledTimes(1);
	});
});

// ============================================================
// Tests: 多 action 顺序 + state 可见性
// ============================================================

describe("registerWorkflowTool — 多 action + state 可见性", () => {
	it("多个 action 按调用顺序执行", async () => {
		const api = mockAPI();
		const order: string[] = [];
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: {
			plan: { description: "plan", handler: vi.fn().mockImplementation(async () => { order.push("plan"); return { content: [{ type: "text" as const, text: "ok" }], details: {} }; }) },
			review: { description: "review", handler: vi.fn().mockImplementation(async () => { order.push("review"); return { content: [{ type: "text" as const, text: "ok" }], details: {} }; }) },
			execute: { description: "exec", handler: vi.fn().mockImplementation(async () => { order.push("execute"); return { content: [{ type: "text" as const, text: "ok" }], details: {} }; }) },
		}, stateManager: mockSM(), uiUpdater: mockUI() });
		const def = (api.registerTool as any).mock.calls[0][0];
		const ctx = createMockContext();
		await def.execute("c1", { action: "plan" }, undefined, undefined, ctx);
		await def.execute("c2", { action: "review" }, undefined, undefined, ctx);
		await def.execute("c3", { action: "execute" }, undefined, undefined, ctx);
		expect(order).toEqual(["plan", "review", "execute"]);
	});

	it("handler A 修改 state 后 handler B 可见", async () => {
		const api = mockAPI();
		const sm = mockSM();
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: {
			plan: { description: "plan", handler: vi.fn().mockImplementation(async (_p, state) => { state.phase = "planned"; state.items.push("step1"); return { content: [{ type: "text" as const, text: "ok" }], details: {} }; }) },
			review: { description: "review", handler: vi.fn().mockImplementation(async (_p, state) => { state.phase = "reviewed"; state.items.push("step2"); return { content: [{ type: "text" as const, text: "ok" }], details: {} }; }) },
		}, stateManager: sm, uiUpdater: mockUI() });
		const def = (api.registerTool as any).mock.calls[0][0];
		const ctx = createMockContext();
		await def.execute("c1", { action: "plan" }, undefined, undefined, ctx);
		expect(sm.get().phase).toBe("planned");
		expect(sm.get().items).toEqual(["step1"]);
		await def.execute("c2", { action: "review" }, undefined, undefined, ctx);
		expect(sm.get().phase).toBe("reviewed");
		expect(sm.get().items).toEqual(["step1", "step2"]);
	});
});
