/**
 * 共享 mock 工具函数：createMockContext 等
 * 供 state.test.ts / workflow.test.ts 使用
 */

import { vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function createMockContext(entries: any[] = []): ExtensionContext {
	return {
		cwd: "/tmp/test",
		hasUI: true,
		ui: {
			setStatus: vi.fn(),
			setWidget: vi.fn(),
			select: vi.fn(),
			confirm: vi.fn(),
			input: vi.fn(),
			notify: vi.fn(),
			onTerminalInput: vi.fn(),
			setWorkingMessage: vi.fn(),
			setWorkingVisible: vi.fn(),
			setWorkingIndicator: vi.fn(),
			setHiddenThinkingLabel: vi.fn(),
		},
		sessionManager: {
			getEntries: vi.fn().mockReturnValue(entries),
		} as any,
		isIdle: vi.fn().mockReturnValue(true),
		signal: undefined,
		abort: vi.fn(),
		hasPendingMessages: vi.fn().mockReturnValue(false),
		shutdown: vi.fn(),
		getContextUsage: vi.fn(),
		compact: vi.fn(),
		getSystemPrompt: vi.fn().mockReturnValue(""),
		model: undefined,
		modelRegistry: {} as any,
	};
}
