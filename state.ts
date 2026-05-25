/**
 * workflow: 通用状态管理
 *
 * 提供两个构建块：
 * 1. createStateManager — 带持久化/恢复的状态管理器
 * 2. createUIUpdater — TUI 状态栏 + Widget 更新器
 *
 * 每个技能/工具定义自己的状态类型，用这两个函数创建唯一管理器。
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ============================================================
// StateManager
// ============================================================

export interface StateManager<T> {
	/** 获取当前 state（同一引用，mutable update） */
	get(): T;
	/** 替换当前 state */
	set(state: T): void;
	/** 重置为 initialState */
	reset(): void;
	/** 持久化状态到 session entry */
	persist(ctx: ExtensionContext): void;
	/** 从 session entries 恢复状态 */
	restore(ctx: ExtensionContext): void;
}

/**
 * 创建带持久化的状态管理器。
 *
 * restore() 边界行为：
 * - 无匹配 entry → 状态保持 initialState，不报错
 * - 多条匹配 → 取最后一条（最新的）
 * - entry.data 损坏（null/非对象/数组）→ 用 initialState 覆盖，不崩溃
 *
 * @param options.stateFile         持久化文件路径（当前未用，保留接口兼容）
 * @param options.initialState      初始状态
 * @param options.sessionEntryType  pi.appendEntry 的 customType
 * @param options.onPersist         可选的持久化回调（用于实际写入 JSON 等）
 */
export function createStateManager<T>(options: {
	stateFile: string;
	initialState: T;
	sessionEntryType: string;
	onPersist?: (state: T) => void;
}): StateManager<T> {
	const initialSnapshot = structuredClone(options.initialState);
	let state: T = structuredClone(options.initialState);
	const entryType = options.sessionEntryType;

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
// UIUpdater
// ============================================================

export interface UIUpdater<T> {
	/** 根据当前 state 更新 status + widget */
	update(ctx: ExtensionContext, state: T): void;
	/** 清除 status + widget */
	clear(ctx: ExtensionContext): void;
}

/**
 * 创建 UI 更新器。
 *
 * @param options.statusKey  ctx.ui.setStatus/setWidget 的 key
 * @param options.phases     每个阶段的 UI 配置。value 用字符串匹配 state.phase。
 */
export function createUIUpdater<T>(options: {
	statusKey: string;
	phases: Array<{
		value: string;
		icon: string;
		label: string;
		color: string;
	}>;
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
