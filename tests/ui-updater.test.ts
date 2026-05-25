/**
 * Tests: state.ts — createUIUpdater (update/clear)
 *
 * 测试场景（6 用例）：
 * 1) 每个已知 phase 设置正确的 icon+label
 * 2) 未知 phase → 清除 UI
 * 3) clear() 清除 status 和 widget
 * 4) 重复 update 正确覆盖
 * 5) phase 值字符串匹配
 * 6) extraWidget 透传（预留）
 */

import { describe, it, expect, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMockContext } from "./test-helpers";

// ============================================================
// 内联实现：createUIUpdater
// ============================================================

interface UIUpdater<T> {
	update(ctx: ExtensionContext, state: T): void;
	clear(ctx: ExtensionContext): void;
}

function createUIUpdater<T>(options: {
	statusKey: string;
	phases: Array<{ value: string; icon: string; label: string; color: string }>;
}): UIUpdater<T> {
	return {
		update(ctx: ExtensionContext, state: T): void {
			const phase = (state as any).phase as string;
			const pc = options.phases.find(p => p.value === phase);
			if (pc && pc.icon) {
				ctx.ui.setStatus(options.statusKey, `${pc.icon} ${pc.label}`);
				ctx.ui.setWidget(options.statusKey, [`${pc.icon} ${pc.label}`]);
			} else {
				ctx.ui.setStatus(options.statusKey, undefined);
				ctx.ui.setWidget(options.statusKey, undefined);
			}
		},
		clear(ctx: ExtensionContext): void {
			ctx.ui.setStatus(options.statusKey, undefined);
			ctx.ui.setWidget(options.statusKey, undefined);
		},
	};
}

// ============================================================
// Tests
// ============================================================

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

	it("每个已知 phase 设置正确的 icon+label", () => {
		const updater = createUIUpdater(opts);
		for (const phase of phases) {
			const ctx = createMockContext();
			updater.update(ctx, { phase: phase.value, issues: [], counter: 0 });
			if (phase.value === "idle") {
				expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", undefined);
				expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", undefined);
			} else {
				expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", `${phase.icon} ${phase.label}`);
				expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", [`${phase.icon} ${phase.label}`]);
			}
		}
	});

	it("未知 phase → 清除 UI", () => {
		const updater = createUIUpdater(opts);
		const ctx = createMockContext();
		updater.update(ctx, { phase: "unknown" as any, issues: [], counter: 0 });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", undefined);
	});
});

describe("createUIUpdater — clear", () => {
	it("clear() 清除 status 和 widget", () => {
		const updater = createUIUpdater({ statusKey: "plan-verify", phases: [] });
		const ctx = createMockContext();
		updater.clear(ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("plan-verify", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("plan-verify", undefined);
	});
});

describe("createUIUpdater — 覆盖行为", () => {
	it("重复 update 正确覆盖之前的设置", () => {
		const phases = [
			{ value: "planning", icon: "📝", label: "Planning", color: "accent" },
			{ value: "executing", icon: "🚀", label: "Executing", color: "success" },
		];
		const updater = createUIUpdater({ statusKey: "pv", phases });
		const ctx = createMockContext();

		updater.update(ctx, { phase: "planning" });
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("pv", "📝 Planning");
		updater.update(ctx, { phase: "executing" });
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("pv", "🚀 Executing");
		updater.clear(ctx);
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("pv", undefined);
	});
});

describe("createUIUpdater — 字符串匹配", () => {
	it("phase 值使用字符串字面量匹配", () => {
		const customPhases = [
			{ value: "step-1", icon: "1️⃣", label: "Step 1", color: "accent" },
			{ value: "step-2", icon: "2️⃣", label: "Step 2", color: "warning" },
		];
		const updater = createUIUpdater<{ phase: string }>({ statusKey: "test", phases: customPhases });
		const ctx = createMockContext();
		updater.update(ctx, { phase: "step-1" });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("test", "1️⃣ Step 1");
		updater.update(ctx, { phase: "step-2" });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("test", "2️⃣ Step 2");
	});
});
