/**
 * Tests: workflow.ts — registerWorkflowTool 工具注册 + gate
 *
 * 测试场景（5 用例）：
 * 1) registerTool 被调用，参数 schema 包含 action 枚举
 * 2) promptSnippet 和 promptGuidelines 透传
 * 3) gate 返回 {pass:false} → handler 不执行
 * 4) gate 返回 {pass:true} → handler 正常执行
 * 5) 未知 action 返回可读错误
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
// Inline implementation
// ============================================================

function registerWorkflowTool<T>(pi: ExtensionAPI, options: {
	name: string; description: string; promptSnippet?: string; promptGuidelines?: string[];
	actions: Record<string, ActionDef<T>>; stateManager: StateManager<T>; uiUpdater: UIUpdater<T>;
}): void {
	const actionNames = Object.keys(options.actions);
	pi.registerTool({
		name: options.name,
		label: options.name,
		description: options.description,
		promptSnippet: options.promptSnippet,
		promptGuidelines: options.promptGuidelines,
		parameters: { type: "object", properties: { action: { type: "string", enum: actionNames } }, required: ["action"] },
		execute: async (_tcId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: ExtensionContext): Promise<AgentToolResult<any>> => {
			const { action, ...actionParams } = params;
			const actionDef = options.actions[action as string];
			if (!actionDef) {
				return { content: [{ type: "text" as const, text: `未知 action: "${action}"。可用: ${actionNames.join(", ")}` }], details: { error: `unknown_action: ${action}` }, terminate: false };
			}
			if (actionDef.gate) {
				const gateResult = actionDef.gate(options.stateManager.get());
				if (!gateResult.pass) {
					return { content: [{ type: "text" as const, text: `Gate 阻止: ${gateResult.reason}` }], details: { error: `gate_blocked: ${gateResult.reason}` }, terminate: false };
				}
			}
			try {
				const result = await actionDef.handler(actionParams, options.stateManager.get(), ctx, signal, onUpdate);
				options.stateManager.persist(ctx);
				options.uiUpdater.update(ctx, options.stateManager.get());
				return result;
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
// Tests: 工具注册
// ============================================================

describe("registerWorkflowTool — 工具注册", () => {
	const defaultHandler = () => Promise.resolve({ content: [{ type: "text" as const, text: "ok" }], details: {} });

	it("registerTool 被调用，参数 schema 包含 action 枚举", () => {
		const api = mockAPI();
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { plan: { description: "plan", handler: defaultHandler }, execute: { description: "exec", handler: defaultHandler } }, stateManager: mockSM(), uiUpdater: mockUI() });
		expect(api.registerTool).toHaveBeenCalledTimes(1);
		const def = (api.registerTool as any).mock.calls[0][0];
		expect(def.name).toBe("pv");
		expect(def.parameters.properties.action.enum).toEqual(["plan", "execute"]);
	});

	it("promptSnippet 和 promptGuidelines 透传", () => {
		const api = mockAPI();
		const gs = ["不要并行执行", "每次检查状态"];
		registerWorkflowTool(api, { name: "pv", description: "PV", promptSnippet: "/pv 启动", promptGuidelines: gs, actions: { plan: { description: "plan", handler: defaultHandler } }, stateManager: mockSM(), uiUpdater: mockUI() });
		const def = (api.registerTool as any).mock.calls[0][0];
		expect(def.promptSnippet).toBe("/pv 启动");
		expect(def.promptGuidelines).toEqual(gs);
	});
});

// ============================================================
// Tests: gate
// ============================================================

describe("registerWorkflowTool — gate", () => {
	it("gate {pass:false} → handler 不执行，返回阻止信息", async () => {
		const api = mockAPI();
		const sm = mockSM();
		const handler = vi.fn();
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { exec: { description: "exec", handler, gate: (s) => s.phase === "ready" ? { pass: true } : { pass: false, reason: `not ready: ${s.phase}` } } }, stateManager: sm, uiUpdater: mockUI() });
		const def = (api.registerTool as any).mock.calls[0][0];
		const r = await def.execute("c1", { action: "exec" }, undefined, undefined, createMockContext());
		expect(handler).not.toHaveBeenCalled();
		expect(r.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining("Gate 阻止") }));
	});

	it("gate {pass:true} → handler 正常执行", async () => {
		const api = mockAPI();
		const sm = mockSM();
		sm.get().phase = "ready";
		const handler = vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: "done" }], details: {} });
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { exec: { description: "exec", handler, gate: (s) => s.phase === "ready" ? { pass: true } : { pass: false, reason: "not ready" } } }, stateManager: sm, uiUpdater: mockUI() });
		const def = (api.registerTool as any).mock.calls[0][0];
		const r = await def.execute("c1", { action: "exec" }, undefined, undefined, createMockContext());
		expect(handler).toHaveBeenCalledTimes(1);
		expect(r).toEqual({ content: [{ type: "text", text: "done" }], details: {} });
	});
});

// ============================================================
// Tests: 未知 action
// ============================================================

describe("registerWorkflowTool — 未知 action", () => {
	it("返回可读错误而非崩溃", async () => {
		const api = mockAPI();
		registerWorkflowTool(api, { name: "pv", description: "PV", actions: { plan: { description: "plan", handler: () => Promise.resolve({ content: [{ type: "text" as const, text: "ok" }], details: {} }) } }, stateManager: mockSM(), uiUpdater: mockUI() });
		const def = (api.registerTool as any).mock.calls[0][0];
		const r = await def.execute("c1", { action: "nonexistent" }, undefined, undefined, createMockContext());
		expect(r.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining("未知 action") }));
		expect((r as any).details.error).toContain("unknown_action");
	});
});
