/**
 * 终端分屏后端抽象（接口 + 检测 + 分派）
 *
 * 统一 WezTerm 和 tmux 的分屏操作接口，
 * 让 spawnVisible 不关心底层终端实现。
 * 后端实现分别在 term-wezterm.ts / term-tmux.ts。
 */

import { weztermBackend } from "./term-wezterm";
import { tmuxBackend } from "./term-tmux";

export type TermType = "wezterm" | "tmux";

export interface TermBackend {
	/** 在新分屏中运行命令，返回新 pane 的 ID */
	splitPane(cwd: string, command: string): string;
	/** 关闭指定 pane */
	killPane(paneId: string): void;
	/** 检查 pane 是否还存活 */
	isPaneAlive(paneId: string): boolean;
}

/** 检测当前终端类型：WezTerm 优先于 tmux */
export function detectTerminal(): TermType | null {
	if (process.env.WEZTERM_PANE) return "wezterm";
	if (process.env.TMUX) return "tmux";
	return null;
}

/** 根据终端类型获取对应后端 */
export function getBackend(type: TermType): TermBackend {
	return type === "wezterm" ? weztermBackend : tmuxBackend;
}
