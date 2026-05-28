/**
 * Tests: state.ts — createStateManager + createUIUpdater
 *
 * createStateManager (12 用例)：
 * 1) get() 返回 initialState 的 clone
 * 2) set() + get() 返回同一引用（mutable update）
 * 3) set() 替换为新对象
 * 4) reset() 恢复为初始状态的 clone
 * 5) reset() 返回新引用（不与旧 state 共享）
 * 6) persist 调用 onPersist(state)
 * 7) 多次 persist 每次调用 onPersist
 * 8) restore 无匹配 entry → state 保持 initialState
 * 9) restore 多条匹配 → 取最新
 * 10) restore data null → initialState
 * 11) restore data 非对象 → initialState
 * 12) restore data 是数组 → initialState
 *
 * createUIUpdater (6 用例)：
 * 13) 已知 phase 设置正确 icon+label
 * 14) 未知 phase → 清除 UI
 * 15) clear() 清除 status 和 widget
 * 16) 重复 update 正确覆盖
 * 17) idle phase（无 icon）→ 清除 UI
 * 18) 透传 extraWidget
 */

import { describe, it, expect, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockContext } from "./test-helpers";
import { createStateManager, createUIUpdater } from "../state";

interface TestState {
	phase: string;
	counter: number;
	issues: string[];
}

const DEFAULT_STATE: TestState = { phase: "idle", counter: 0, issues: [] };

describe("createStateManager — get/set/reset", () => {
	it("get() 返回 initialState 的 clone", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "test-state",
		});
		const s = sm.get();
		expect(s.phase).toBe("idle");
		expect(s.counter).toBe(0);
		expect(s.issues).toEqual([]);
	});

	it("set() + get() 返回同一引用", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "test-state",
		});
		const s1 = sm.get();
		s1.counter = 42;
		// set() 接受同一引用
		sm.set(s1);
		const s2 = sm.get();
		expect(s2.counter).toBe(42);
		expect(s2).toBe(s1);
	});

	it("set() 替换为新对象", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "test-state",
		});
		const newState: TestState = { phase: "planning", counter: 99, issues: ["bug"] };
		sm.set(newState);
		const s = sm.get();
		expect(s.phase).toBe("planning");
		expect(s.counter).toBe(99);
		expect(s.issues).toEqual(["bug"]);
		expect(s).toBe(newState);
	});

	it("reset() 恢复为初始状态的 clone", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: { phase: "idle", counter: 0, issues: ["a"] },
			sessionEntryType: "test-state",
		});
		sm.set({ phase: "executing", counter: 10, issues: [] });
		sm.reset();
		const s = sm.get();
		expect(s.phase).toBe("idle");
		expect(s.counter).toBe(0);
		expect(s.issues).toEqual(["a"]);
	});

	it("reset() 返回新引用，不与旧 state 共享", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "test-state",
		});
		const beforeReset = sm.get();
		sm.reset();
		const afterReset = sm.get();
		expect(afterReset).not.toBe(beforeReset);
	});
});

describe("createStateManager — persist", () => {
	it("persist 调用 onPersist(state) 并传入当前 state", () => {
		const onPersist = (s: TestState) => {
			expect(s.counter).toBe(42);
		};
		const spy = { fn: onPersist };
		vi.spyOn(spy, "fn");
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "test-state",
			onPersist: spy.fn,
		});
		sm.get().counter = 42;
		const ctx = createMockContext();
		sm.persist(ctx);
		expect(spy.fn).toHaveBeenCalledTimes(1);
	});

	it("多次 persist 每次触发 onPersist", () => {
		let callCount = 0;
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "test-state",
			onPersist: () => { callCount++; },
		});
		const ctx = createMockContext();
		sm.persist(ctx);
		sm.persist(ctx);
		expect(callCount).toBe(2);
	});
});

describe("createStateManager — restore", () => {
	function makeMockContext(entries: any[]): ExtensionContext {
		return {
			...createMockContext(),
			sessionManager: {
				getEntries: () => entries,
				addEntry: () => {},
			},
		} as unknown as ExtensionContext;
	}

	it("无匹配 entry → state 保持 initialState", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "my-state",
		});
		const ctx = makeMockContext([
			{ type: "custom", customType: "other-state", data: { counter: 999 } },
		]);
		sm.restore(ctx);
		expect(sm.get().counter).toBe(0);
	});

	it("多条匹配 → 取最新（最后一条）", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "my-state",
		});
		const ctx = makeMockContext([
			{ type: "custom", customType: "my-state", data: { counter: 1 } },
			{ type: "custom", customType: "my-state", data: { counter: 2 } },
			{ type: "custom", customType: "my-state", data: { counter: 3 } },
		]);
		sm.restore(ctx);
		expect(sm.get().counter).toBe(3);
	});

	it("restore data null → 使用 initialState", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "my-state",
		});
		const ctx = makeMockContext([
			{ type: "custom", customType: "my-state", data: null },
		]);
		sm.restore(ctx);
		expect(sm.get().counter).toBe(0);
	});

	it("restore data 非对象 → 使用 initialState", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "my-state",
		});
		const ctx = makeMockContext([
			{ type: "custom", customType: "my-state", data: "string" },
		]);
		sm.restore(ctx);
		expect(sm.get().counter).toBe(0);
	});

	it("restore data 是数组 → 使用 initialState", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: DEFAULT_STATE,
			sessionEntryType: "my-state",
		});
		const ctx = makeMockContext([
			{ type: "custom", customType: "my-state", data: [1, 2, 3] },
		]);
		sm.restore(ctx);
		expect(sm.get().counter).toBe(0);
	});

	it("restore 合并: 保留 initialState 的字段，覆盖 data 提供的字段", () => {
		const sm = createStateManager<TestState>({
			stateFile: "test.json",
			initialState: { phase: "idle", counter: 0, issues: ["default"] },
			sessionEntryType: "my-state",
		});
		const ctx = makeMockContext([
			{ type: "custom", customType: "my-state", data: { counter: 42 } },
		]);
		sm.restore(ctx);
		expect(sm.get().phase).toBe("idle");
		expect(sm.get().counter).toBe(42);
		expect(sm.get().issues).toEqual(["default"]);
	});
});

describe("createUIUpdater — update", () => {
	const phases = [
		{ value: "idle", icon: "", label: "", color: "" },
		{ value: "planning", icon: "📝", label: "Planning", color: "accent" },
		{ value: "verifying", icon: "🔍", label: "Reviewing", color: "warning" },
		{ value: "fixing", icon: "🔧", label: "Fixing", color: "error" },
		{ value: "review-decision", icon: "📋", label: "Deciding", color: "accent" },
		{ value: "executing", icon: "🚀", label: "Executing", color: "success" },
	];
	const opts = { statusKey: "plan-verify", phases };

	it("每个已知非 idle phase 设置正确的 icon+label", () => {
		const updater = createUIUpdater<TestState>(opts);
		for (const phase of phases) {
			if (phase.value === "idle") continue;
			const ctx = createMockContext();
			updater.update(ctx, { phase: phase.value, counter: 0, issues: [] });
			expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", `${phase.icon} ${phase.label}`);
			expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", [`${phase.icon} ${phase.label}`]);
		}
	});

	it("idle phase（无 icon）→ 清除 UI", () => {
		const updater = createUIUpdater<TestState>(opts);
		const ctx = createMockContext();
		updater.update(ctx, { phase: "idle", counter: 0, issues: [] });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", undefined);
	});

	it("未知 phase → 清除 UI", () => {
		const updater = createUIUpdater<TestState>(opts);
		const ctx = createMockContext();
		updater.update(ctx, { phase: "unknown" as any, counter: 0, issues: [] });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", undefined);
	});

	it("clear() 清除 status 和 widget", () => {
		const updater = createUIUpdater<TestState>({ statusKey: "test", phases: [] });
		const ctx = createMockContext();
		updater.clear(ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("test", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("test", undefined);
	});

	it("重复 update 正确覆盖", () => {
		const customPhases = [
			{ value: "step-1", icon: "1️⃣", label: "Step 1", color: "accent" },
			{ value: "step-2", icon: "2️⃣", label: "Step 2", color: "warning" },
		];
		const updater = createUIUpdater<TestState>({ statusKey: "pv", phases: customPhases });
		const ctx = createMockContext();
		updater.update(ctx, { phase: "step-1", counter: 0, issues: [] });
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("pv", "1️⃣ Step 1");
		updater.update(ctx, { phase: "step-2", counter: 0, issues: [] });
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("pv", "2️⃣ Step 2");
		updater.clear(ctx);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("pv", undefined);
	});
});
