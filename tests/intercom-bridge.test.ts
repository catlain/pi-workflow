/**
 * 测试 intercom-bridge.ts — 桥接环境变量构建与唯一性
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	buildIntercomBridge,
	resolveOrchestratorName,
	setOrchestratorNameResolver,
} from "../intercom-bridge";

describe("buildIntercomBridge", () => {
	it("返回完整 5 变量集", () => {
		const env = buildIntercomBridge("orch-1", "fo-analyzer");
		expect(env).toEqual({
			PI_SUBAGENT_ORCHESTRATOR_TARGET: "orch-1",
			PI_SUBAGENT_RUN_ID: expect.stringMatching(/^run-/) as string,
			PI_SUBAGENT_CHILD_AGENT: "fo-analyzer",
			PI_SUBAGENT_CHILD_INDEX: "1",
			PI_SUBAGENT_INTERCOM_SESSION_NAME: expect.stringContaining("fo-analyzer") as string,
		});
	});

	it("orchestrator 名为空时回退 orchestrator", () => {
		const env = buildIntercomBridge(undefined, "pv-executor");
		expect(env.PI_SUBAGENT_ORCHESTRATOR_TARGET).toBe("orchestrator");
	});

	it("同一进程连续两次调用的 run-id 与 session-name 互不相同", () => {
		const e1 = buildIntercomBridge("o", "agent-a");
		const e2 = buildIntercomBridge("o", "agent-a");
		expect(e1.PI_SUBAGENT_RUN_ID).not.toBe(e2.PI_SUBAGENT_RUN_ID);
		expect(e1.PI_SUBAGENT_INTERCOM_SESSION_NAME).not.toBe(e2.PI_SUBAGENT_INTERCOM_SESSION_NAME);
		// child-index 进程内自增（跨用例共享模块计数器，断言递增关系）
		expect(Number(e2.PI_SUBAGENT_CHILD_INDEX)).toBe(Number(e1.PI_SUBAGENT_CHILD_INDEX) + 1);
	});

	it("不同 agent 名注入各自的 CHILD_AGENT", () => {
		expect(buildIntercomBridge("o", "fo-analyzer").PI_SUBAGENT_CHILD_AGENT).toBe("fo-analyzer");
		expect(buildIntercomBridge("o", "fr-searcher").PI_SUBAGENT_CHILD_AGENT).toBe("fr-searcher");
	});
});

describe("resolveOrchestratorName", () => {
	beforeEach(() => {
		setOrchestratorNameResolver(undefined);
	});

	it("未注册 resolver 时返回 undefined", async () => {
		expect(await resolveOrchestratorName()).toBeUndefined();
	});

	it("注册后返回 resolver 结果", async () => {
		setOrchestratorNameResolver(async () => "main-session");
		expect(await resolveOrchestratorName()).toBe("main-session");
	});

	it("resolver 抛错时安全降级为 undefined", async () => {
		setOrchestratorNameResolver(() => { throw new Error("boom"); });
		expect(await resolveOrchestratorName()).toBeUndefined();
	});

	it("resolver 可注销", async () => {
		setOrchestratorNameResolver(async () => "x");
		setOrchestratorNameResolver(undefined);
		expect(await resolveOrchestratorName()).toBeUndefined();
	});
});
