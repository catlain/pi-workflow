/**
 * 测试 subagent-model.ts — 模型持久化（安全读写路径）
 *
 * 读：getEffectiveConfig 三层合并；写：patchSettingsSectionWithBackup
 * 禁止裸 readFileSync/writeFileSync 整文件读写。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { patchMock } = vi.hoisted(() => ({
	patchMock: vi.fn(),
}));

vi.mock("@pi-atelier/shared-utils", () => ({
	getEffectiveConfig: vi.fn(),
	getSettingsValue: vi.fn(),
	patchSettingsSectionWithBackup: patchMock,
}));

import {
	getSubagentModel,
	setSubagentModel,
	restoreSubagentModel,
	isSubagentModelRestored,
	setSubagentModelRestored,
} from "../subagent-model";
import { getEffectiveConfig, getSettingsValue } from "@pi-atelier/shared-utils";

describe("subagent-model 持久化", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setSubagentModelRestored(false);
	});

	it("restore 从 subagent.defaultModel 读取（getEffectiveConfig）", () => {
		(getEffectiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
			config: { defaultModel: "zai/glm-5.2" },
			sources: {},
		});
		restoreSubagentModel("/proj");
		expect(getEffectiveConfig).toHaveBeenCalledWith(
			"subagent", expect.any(Object), "/proj",
		);
		expect(getSubagentModel()).toBe("zai/glm-5.2");
		expect(isSubagentModelRestored()).toBe(true);
	});

	it("未配置时回退 defaultProvider/defaultModel 组合", () => {
		(getEffectiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
			config: { defaultModel: "" },
			sources: {},
		});
		(getSettingsValue as ReturnType<typeof vi.fn>)
			.mockReturnValueOnce("zai")
			.mockReturnValueOnce("glm-4.6");
		restoreSubagentModel();
		expect(getSubagentModel()).toBe("zai/glm-4.6");
	});

	it("set 写入走 patchSettingsSectionWithBackup（带锁）", () => {
		(getEffectiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
			config: { defaultModel: "" },
			sources: {},
		});
		setSubagentModel("deepseek/deepseek-v4-flash");
		expect(patchMock).toHaveBeenCalledWith(
			"subagent",
			{ defaultModel: "deepseek/deepseek-v4-flash" },
			expect.any(Object),
		);
		expect(getSubagentModel()).toBe("deepseek/deepseek-v4-flash");
	});

	it("读取异常时安全降级为空串", () => {
		(getEffectiveConfig as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("settings broken");
		});
		restoreSubagentModel();
		expect(getSubagentModel()).toBe("");
	});

	it("写入异常不阻塞主流程", () => {
		patchMock.mockImplementation(() => { throw new Error("lock fail"); });
		(getEffectiveConfig as ReturnType<typeof vi.fn>).mockReturnValue({
			config: { defaultModel: "" },
			sources: {},
		});
		expect(() => setSubagentModel("x/y")).not.toThrow();
		expect(getSubagentModel()).toBe("x/y");
	});
});
