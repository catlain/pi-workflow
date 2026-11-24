/**
 * 测试 F1 失败档修复的 runSubagent 层（opsx-subarch-meta-baseline，spec: subagent-spawn-runtime）
 *
 * spec 五 scenario（mock spawnOnce/spawnVisible）：
 * 1. 系统性失败不重试且透出 stderr（exit 0 + 占位 + stderr 非空）
 * 2. 个体违约保留重试（违约 + stderr 空）
 * 3. 正常完成零输出不误伤（3a 无 constraints 原样返回 / 3b 有 constraints 走违约重试档）
 * 4. 有实质输出时 stderr 不影响成功判定
 * 5.（库侧）visible jsonl 信号源 error 注入后走系统性失败档
 *
 * 纯函数层在 subagent-failure-classification.test.ts；
 * visible 模式 jsonl 三形态用例在 subagent-spawn-visible.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@pi-atelier/shared-utils", () => ({
	loadAgentDef: vi.fn(),
	getEffectiveConfig: vi.fn(() => ({ config: {}, sources: {} })),
}));
vi.mock("../timeout-config", () => ({
	resolveSubagentTimeout: vi.fn(() => 30 * 60 * 1000),
	DEFAULT_SUBAGENT_TIMEOUT_MS: 30 * 60 * 1000,
	SUBAGENT_TIMEOUT_DEFAULTS: { timeoutMs: 1800000, agentTimeouts: {} },
}));
vi.mock("../intercom-bridge", () => ({
	buildIntercomBridge: vi.fn(() => ({ PI_SUBAGENT_RUN_ID: "run-test" })),
	resolveOrchestratorName: vi.fn(async () => undefined),
	setOrchestratorNameResolver: vi.fn(),
}));
vi.mock("../subagent-utils", () => ({
	writeTempPrompt: vi.fn().mockResolvedValue("/tmp/pi-pv-xxx/system-prompt.md"),
	getPiCommand: vi.fn(),
}));
vi.mock("../subagent-spawn-once", () => ({ spawnOnce: vi.fn() }));
vi.mock("../subagent-spawn-visible", () => ({ spawnVisible: vi.fn() }));

import { loadAgentDef } from "@pi-atelier/shared-utils";
import { spawnOnce } from "../subagent-spawn-once";
import { spawnVisible } from "../subagent-spawn-visible";
import { runSubagent } from "../subagent";

const GOOD_CONSTRAINT = [{
	rule: "必须包含 GOOD",
	validate: (s: string) => (s.includes("GOOD") ? null : "缺少 GOOD"),
}];

describe("runSubagent 失败档（spec: subagent-spawn-runtime）", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(loadAgentDef as ReturnType<typeof vi.fn>).mockReturnValue({
			name: "test-agent",
			tools: ["read"],
			systemPrompt: "You are a test agent",
		});
		delete process.env.TMUX;
		delete process.env.WEZTERM_PANE;
	});

	it("Scenario 1：系统性失败不重试且透出 stderr（exit 0 + 占位 + stderr 非空）", async () => {
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "(no output)",
			stderr: "Error: Cannot find module './judge'\n    at require (node:internal)",
		});
		const result = await runSubagent(
			"test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, GOOD_CONSTRAINT, false,
		);
		// 重试计数为零：spawn 只被调用 1 次
		expect(spawnOnce).toHaveBeenCalledTimes(1);
		// 失败档闭合标记
		expect(result.error).toBeTruthy();
		// 报错信息含 stderr 尾部原文
		expect(result.output).toContain("Cannot find module './judge'");
		// exitCode 保持子进程原值（本场景即 0）
		expect(result.exitCode).toBe(0);
		// stderr 不被剥离
		expect(result.stderr).toContain("Cannot find module './judge'");
	});

	it("Scenario 2：个体违约保留重试（违约 + stderr 空 → 下一轮修正）", async () => {
		(spawnOnce as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ exitCode: 0, output: "bad format", stderr: "" })
			.mockResolvedValueOnce({ exitCode: 0, output: "GOOD format", stderr: "" });
		const result = await runSubagent(
			"test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, GOOD_CONSTRAINT, false,
		);
		expect(spawnOnce).toHaveBeenCalledTimes(2);
		expect(result.output).toBe("GOOD format");
	});

	it("Scenario 3a：正常完成零输出不误伤（无 constraints 原样返回）", async () => {
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "(no output)",
			stderr: "",
		});
		const result = await runSubagent("test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, undefined, false);
		expect(result.output).toBe("(no output)");
		expect(result.error).toBeUndefined();
		expect(spawnOnce).toHaveBeenCalledTimes(1);
	});

	it("Scenario 3b：正常完成零输出 + constraints → 按违约走个体失败重试档（现状）", async () => {
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "(no output)",
			stderr: "",
		});
		const result = await runSubagent(
			"test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, GOOD_CONSTRAINT, false,
		);
		// 现状行为：占位输出不满足约束 → 重派满 MAX_RETRIES=2
		expect(spawnOnce).toHaveBeenCalledTimes(3);
		expect(result.output).toBe("(no output)");
	});

	it("Scenario 4：有实质输出时 stderr 不影响成功判定", async () => {
		(spawnOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "GOOD substantial output",
			stderr: "non-fatal deprecation warning",
		});
		const result = await runSubagent(
			"test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, GOOD_CONSTRAINT, false,
		);
		expect(spawnOnce).toHaveBeenCalledTimes(1);
		expect(result.error).toBeUndefined();
		expect(result.output).toBe("GOOD substantial output");
	});

	it("Scenario 5（库侧）：visible jsonl 信号源 error 注入后走系统性失败档", async () => {
		// spawnVisible 被 mock：直接产出 finish() 注入信号后的形态（error 含信号源注明）
		(spawnVisible as ReturnType<typeof vi.fn>).mockResolvedValue({
			exitCode: 0,
			output: "(no output)",
			stderr: "",
			error: "visible 模式信号源=jsonl 终结形态：session.jsonl 无 message 事件（未进入对话阶段）",
		});
		process.env.TMUX = "1";
		const result = await runSubagent(
			"test-agent", "task", "/cwd", undefined, undefined, undefined, undefined, GOOD_CONSTRAINT,
		);
		delete process.env.TMUX;
		expect(spawnVisible).toHaveBeenCalledTimes(1); // 不重试
		expect(result.error).toContain("visible 模式信号源=jsonl 终结形态");
		expect(result.output).toContain("visible 模式信号源=jsonl 终结形态");
	});
});
