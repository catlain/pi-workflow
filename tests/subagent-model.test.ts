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
	resolveSelectedByLabel,
} from "../subagent-model";
// barrel 防回归：子路径 import 测不到导出遗漏（resolveSelectedByLabel 曾漏导出，UI 侧 import 得 undefined → TypeError 被 catch 吞）
import * as wfBarrel from "../index";
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

describe("resolveSelectedByLabel 索引精确回查（前缀子串陷阱）", () => {
	// 复现 fix-subagent-model-select-persist D1：选 glm-5.3-flash 被 includes 误配成 glm-5.3
	interface Item {
		value: string;
		label: string;
	}

	const items: Item[] = [
		{ value: "zai-coding-cn/glm-4.6v", label: "GLM-4.6V" },
		{ value: "zai-coding-cn/glm-5.3", label: "GLM-5.3" },
		{ value: "zai-coding-cn/glm-5.3-flash", label: "GLM-5.3-Flash" },
		{ value: "zai-coding-cn/glm-5.3-highspeed", label: "GLM-5.3-Highspeed" },
		{ value: "zai-coding-cn/glm-5.4", label: "GLM-5.4" },
	];
	const labelOf = (m: Item) => `  ${m.value} (${m.label})`;

	it("选长 ID（glm-5.3-flash）不被短 ID（glm-5.3）前缀劫持", () => {
		const choice = labelOf(items[2]);
		expect(
			resolveSelectedByLabel(items.map(labelOf), items, choice),
		).toBe(items[2]);
	});

	it("选短 ID（glm-5.3）不受更长兄弟干扰", () => {
		const choice = labelOf(items[1]);
		expect(
			resolveSelectedByLabel(items.map(labelOf), items, choice),
		).toBe(items[1]);
	});

	it("当前项提前重排后索引仍对齐（● 前缀）", () => {
		const reordered = [items[4], items[0], items[1], items[2], items[3]];
		const labels = reordered.map((m, i) =>
			i === 0 ? `● ${m.value} (${m.label})` : `  ${m.value} (${m.label})`,
		);
		expect(resolveSelectedByLabel(labels, reordered, labels[3])).toBe(items[2]);
	});

	it("未匹配（choice 不在 labels）返回 undefined", () => {
		expect(
			resolveSelectedByLabel(items.map(labelOf), items, "nope"),
		).toBeUndefined();
	});

	it("旧实现反例：includes 子串匹配会误命中（回归警示）", () => {
		// 模拟旧 find+includes 行为，证明本修复的必要性
		const choice = labelOf(items[2]);
		const legacy = items.find((m) => choice.includes(m.value));
		expect(legacy).toBe(items[1]); // 旧逻辑抓错：flash 被 glm-5.3 劫持
		expect(legacy).not.toBe(items[2]);
	});
});

describe("barrel 导出防回归", () => {
	// 子路径 import 测不到 index.ts 导出遗漏；resolveSelectedByLabel 曾漏导出致 UI 侧 TypeError 被 catch 吞
	it("resolveSelectedByLabel 经 index.ts barrel 可达", () => {
		expect(typeof wfBarrel.resolveSelectedByLabel).toBe("function");
		expect(typeof wfBarrel.setSubagentModel).toBe("function");
		expect(typeof wfBarrel.getSubagentModel).toBe("function");
		expect(typeof wfBarrel.restoreSubagentModel).toBe("function");
	});
});
