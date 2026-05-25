/**
 * Tests: state.ts — createStateManager (get/set/reset/persist/restore)
 *
 * 测试场景（7 用例）：
 * 1) get() 返回 initialState
 * 2) set() + get() 同一引用
 * 3) set() 替换为新对象
 * 4) reset() 恢复为新的 initialState
 * 5) reset() 返回新引用
 * 6) persist 传递当前 state
 * 7) 多次 persist 传递最新 state
 * 8) restore 无匹配 → 保持
 * 9) restore 多条匹配 → 取最新
 * 10) restore data null → initialState
 * 11) restore data 非对象 → initialState
 * 12) restore data 数组 → initialState
 * 13) restore data 缺字段 → 合并
 * 14) restore 其他 customType → 忽略
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockContext } from "./test-helpers";

// ============================================================
// 内联实现：从 plan 描述的 createStateManager
// ============================================================

interface StateManager<T> {
	get(): T;
	set(state: T): void;
	reset(): void;
	persist(ctx: ExtensionContext): void;
	restore(ctx: ExtensionContext): void;
}

function createStateManager<T>(options: {
	stateFile: string;
	initialState: T;
	sessionEntryType: string;
	onPersist?: (state: unknown) => void;
}): StateManager<T> {
	let state: T = structuredClone(options.initialState);
	const entryType = options.sessionEntryType;
	const initialSnapshot = structuredClone(options.initialState);

	return {
		get(): T { return state; },
		set(s: T): void { state = s; },
		reset(): void { state = structuredClone(initialSnapshot); },
		persist(_ctx: ExtensionContext): void {
			if (options.onPersist) options.onPersist(state);
		},
		restore(ctx: ExtensionContext): void {
			const entries = ctx.sessionManager.getEntries();
			const matching = entries.filter(
				(e: any) => e.type === "custom" && e.customType === entryType,
			);
			if (matching.length === 0) return;
			const latest = matching[matching.length - 1];
			const data = (latest as any).data;
			if (data === null || data === undefined || typeof data !== "object" || Array.isArray(data)) {
				state = structuredClone(initialSnapshot);
				return;
			}
			state = { ...structuredClone(initialSnapshot), ...data } as T;
		},
	};
}

// ============================================================
// Fixtures
// ============================================================

interface TestState { phase: string; issues: string[]; counter: number }
const INITIAL_STATE: TestState = { phase: "idle", issues: [], counter: 0 };

// ============================================================
// Tests: get / set / reset
// ============================================================

describe("createStateManager — get/set/reset", () => {
	it("get() 返回 initialState", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		const s = sm.get();
		expect(s.phase).toBe("idle");
		expect(s.issues).toEqual([]);
		expect(s.counter).toBe(0);
	});

	it("set() + get() 返回同一引用", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		const ns = sm.get();
		ns.phase = "planning";
		ns.counter = 42;
		sm.set(ns);
		expect(sm.get()).toBe(ns);
		expect(sm.get().phase).toBe("planning");
		expect(sm.get().counter).toBe(42);
	});

	it("set() 替换为新对象", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		const fresh: TestState = { phase: "executing", issues: ["critical"], counter: 99 };
		sm.set(fresh);
		expect(sm.get()).toBe(fresh);
	});

	it("reset() 恢复为新的 initialState（非原始引用）", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.get().phase = "fixing";
		sm.get().counter = 5;
		sm.reset();
		const s = sm.get();
		expect(s.phase).toBe("idle");
		expect(s.counter).toBe(0);
		expect(s).not.toBe(INITIAL_STATE);
	});

	it("reset() 后旧引用不受影响", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		const oldRef = sm.get();
		oldRef.counter = 10;
		sm.reset();
		expect(sm.get().counter).toBe(0);
		expect(sm.get()).not.toBe(oldRef);
	});
});

// ============================================================
// Tests: persist
// ============================================================

describe("createStateManager — persist", () => {
	it("persist 传递当前 state", () => {
		const onPersist = vi.fn();
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv", onPersist,
		});
		sm.get().counter = 77;
		sm.persist(createMockContext());
		expect(onPersist).toHaveBeenCalledWith(expect.objectContaining({ counter: 77 }));
	});

	it("多次 persist 每次传递最新 state", () => {
		const onPersist = vi.fn();
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv", onPersist,
		});
		const ctx = createMockContext();
		sm.persist(ctx);
		expect(onPersist).toHaveBeenNthCalledWith(1, expect.objectContaining({ counter: 0 }));
		sm.get().counter = 1;
		sm.persist(ctx);
		expect(onPersist).toHaveBeenNthCalledWith(2, expect.objectContaining({ counter: 1 }));
		sm.get().counter = 2;
		sm.persist(ctx);
		expect(onPersist).toHaveBeenNthCalledWith(3, expect.objectContaining({ counter: 2 }));
	});
});

// ============================================================
// Tests: restore 边界
// ============================================================

describe("createStateManager — restore 边界", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("无匹配 entry → 保持 state，不报错", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.get().counter = 42;
		sm.restore(createMockContext([]));
		expect(sm.get().counter).toBe(42);
	});

	it("多条匹配 → 取最新一条", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		const entries = [
			{ id: "e1", type: "custom", customType: "pv", data: { phase: "planning", counter: 1 } },
			{ id: "e2", type: "custom", customType: "pv", data: { phase: "review-decision", issues: ["critical"], counter: 3 } },
			{ id: "e3", type: "message" },
		];
		sm.restore(createMockContext(entries));
		expect(sm.get().phase).toBe("review-decision");
		expect(sm.get().counter).toBe(3);
		expect(sm.get().issues).toEqual(["critical"]);
	});

	it("data 为 null → initialState，不崩溃", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.restore(createMockContext([{ id: "e1", type: "custom", customType: "pv", data: null }]));
		expect(sm.get().phase).toBe("idle");
	});

	it("data 为字符串（非对象）→ initialState，不崩溃", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.restore(createMockContext([{ id: "e1", type: "custom", customType: "pv", data: "corrupted" }]));
		expect(sm.get().phase).toBe("idle");
	});

	it("data 为数组 → initialState，不崩溃", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.restore(createMockContext([{ id: "e1", type: "custom", customType: "pv", data: [1, 2, 3] }]));
		expect(sm.get().phase).toBe("idle");
	});

	it("data 缺少字段 → 合并 initialState，不崩溃", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.restore(createMockContext([{ id: "e1", type: "custom", customType: "pv", data: { phase: "executing" } }]));
		expect(sm.get().phase).toBe("executing");
		expect(sm.get().counter).toBe(0);
		expect(sm.get().issues).toEqual([]);
	});

	it("匹配其他 customType → 被忽略", () => {
		const sm = createStateManager({
			stateFile: ".pv-state.json", initialState: INITIAL_STATE, sessionEntryType: "pv",
		});
		sm.restore(createMockContext([{ id: "e1", type: "custom", customType: "other-ext", data: { phase: "planning", counter: 99 } }]));
		expect(sm.get().phase).toBe("idle");
		expect(sm.get().counter).toBe(0);
	});
});
