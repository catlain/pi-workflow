/**
 * 测试 F1 失败档修复（opsx-subarch-meta-baseline，spec: subagent-spawn-runtime）
 *
 * 本文件覆盖纯函数层：
 * 1. 占位文本字面量锁死（防文本漂移静默破坏分类）
 * 2. isSystemicSubagentFailure 三级信号优先级
 * 3. isSubagentSuccess 端到端锁死（系统性失败结果 === false）
 * 4. buildSystemicFailureResult 组装契约（error 必填/exitCode 原值/stderr 尾部透出）
 * 5. barrel 断言（新导出同步 index.ts）
 *
 * runSubagent spec 五 scenario 在 subagent-failure-retry.test.ts；
 * visible 模式 jsonl 三形态用例在 subagent-spawn-visible.test.ts。
 */
import { describe, it, expect } from "vitest";

import {
	EMPTY_OUTPUT_PLACEHOLDERS,
	STDERR_TAIL_LIMIT,
	isEmptyPlaceholderOutput,
	isSystemicSubagentFailure,
	buildSystemicFailureResult,
	isSubagentSuccess,
} from "../utils";

describe("F1 字面量锁死", () => {
	it("EMPTY_OUTPUT_PLACEHOLDERS 逐字锁定（含 spawn 分支兜底文本）", () => {
		expect(EMPTY_OUTPUT_PLACEHOLDERS).toEqual([
			"(no output)",
			"(stalled, no output for 5 min)",
			"(timed out)",
		]);
	});

	it("isEmptyPlaceholderOutput：空串/空白/占位前缀或包含均命中，实质输出不命中", () => {
		expect(isEmptyPlaceholderOutput("")).toBe(true);
		expect(isEmptyPlaceholderOutput("   \n  ")).toBe(true);
		expect(isEmptyPlaceholderOutput("(no output)")).toBe(true);
		// formatOutput 包装后的前缀形态（如折行后仍在场）
		expect(isEmptyPlaceholderOutput("(no output)\n")).toBe(true);
		expect(isEmptyPlaceholderOutput("prefix junk (timed out) suffix")).toBe(true);
		expect(isEmptyPlaceholderOutput("(stalled, no output for 5 min)")).toBe(true);
		expect(isEmptyPlaceholderOutput("这是实质输出，虽然很短")).toBe(false);
	});
});

describe("isSystemicSubagentFailure：三级信号优先级", () => {
	it("① error 字段存在 → 系统性失败（含 visible jsonl 信号源形态）", () => {
		expect(isSystemicSubagentFailure({ output: "anything", error: "spawn ENOENT" })).toBe(true);
		expect(
			isSystemicSubagentFailure({
				output: "(no output)",
				error: "visible 模式信号源=jsonl 终结形态：session.jsonl 缺失（子进程未建立会话）",
			}),
		).toBe(true);
	});

	it("① 空串 error 视为无 error（不命中）", () => {
		expect(isSystemicSubagentFailure({ output: "ok", error: "" })).toBe(false);
	});

	it("② timedOut 布尔 → 系统性失败", () => {
		expect(isSystemicSubagentFailure({ output: "ok", timedOut: true })).toBe(true);
		expect(isSystemicSubagentFailure({ output: "ok", timedOut: false })).toBe(false);
	});

	it("③ 空占位输出兼 stderr 非空 → 系统性失败（R4 实证形态：exit 0 静默退出）", () => {
		expect(
			isSystemicSubagentFailure({ output: "(no output)", stderr: "Error: Cannot find module './judge'" }),
		).toBe(true);
	});

	it("③ 空占位但 stderr 空 → 不命中（正常完成零输出档，回落现状）", () => {
		expect(isSystemicSubagentFailure({ output: "(no output)", stderr: "" })).toBe(false);
		expect(isSystemicSubagentFailure({ output: "(no output)" })).toBe(false);
	});

	it("③ 有实质输出时 stderr 噪声不参与判定（不误伤）", () => {
		expect(isSystemicSubagentFailure({ output: "x".repeat(200), stderr: "some non-fatal warning" })).toBe(false);
	});
});

describe("isSubagentSuccess 端到端锁死", () => {
	it("系统性失败结果（buildSystemicFailureResult 组装后）=== false", () => {
		const result = buildSystemicFailureResult({
			exitCode: 0,
			output: "(no output)",
			stderr: "Error: Cannot find module './judge'",
		});
		expect(isSubagentSuccess(result)).toBe(false);
	});

	it("原始系统性失败形态（exit 0 + 空占位 + stderr 非空）=== false —— 修复前此处为 true", () => {
		expect(
			isSubagentSuccess({ exitCode: 0, output: "(no output)", stderr: "Error: Cannot find module './judge'" }),
		).toBe(false);
	});

	it("有实质输出 + stderr 噪声 → 成功（现状不变）", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "x".repeat(200), stderr: "warn noise" })).toBe(true);
	});

	it("正常完成零输出 + stderr 空 → 维持既有判定（现状语义：exit 0 即成功）", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "(no output)", stderr: "" })).toBe(true);
	});
});

describe("buildSystemicFailureResult 组装契约", () => {
	it("error 必填 + output 含报错与 stderr 尾部 + exitCode 保持原值 0", () => {
		const result = buildSystemicFailureResult({
			exitCode: 0,
			output: "(no output)",
			stderr: "line1: extension load failed\nline2: Cannot find module './judge'",
		});
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeTruthy();
		expect(result.output).toContain("[子代理系统性失败]");
		expect(result.output).toContain("stderr 尾部");
		expect(result.output).toContain("Cannot find module './judge'");
	});

	it("stderr 超长截尾（保留尾部）", () => {
		const stderr = `${"a".repeat(STDERR_TAIL_LIMIT + 500)}TAIL_MARKER`;
		const result = buildSystemicFailureResult({ exitCode: 1, output: "(no output)", stderr });
		expect(result.output).toContain("TAIL_MARKER");
		expect(result.stderr.length).toBe(stderr.length); // stderr 原文不动（不剥离）
		expect(result.output.length).toBeLessThan(stderr.length); // output 中只透出尾部
	});

	it("visible jsonl 信号源的 error 注入后透传进报错行", () => {
		const result = buildSystemicFailureResult({
			exitCode: 0,
			output: "(no output)",
			stderr: "",
			error: "visible 模式信号源=jsonl 终结形态：session.jsonl 无 message 事件（未进入对话阶段）",
		});
		expect(result.output).toContain("visible 模式信号源=jsonl 终结形态");
		expect(result.error).toContain("visible 模式信号源=jsonl 终结形态");
	});

	it("timedOut 形态：error 标注 timed out", () => {
		const result = buildSystemicFailureResult({ exitCode: 1, output: "(timed out)", stderr: "", timedOut: true });
		expect(result.output).toContain("[子代理系统性失败] timed out");
		expect(result.error).toBeTruthy();
	});
});

// ─── barrel 断言（新导出同步 index.ts）───────────────────────────────────

describe("barrel 导出断言", () => {
	it("index.ts 显式导出 F1 失败分类 API", async () => {
		const api = await import("../index");
		expect(typeof api.isSystemicSubagentFailure).toBe("function");
		expect(typeof api.buildSystemicFailureResult).toBe("function");
		expect(typeof api.isEmptyPlaceholderOutput).toBe("function");
		expect(Array.isArray(api.EMPTY_OUTPUT_PLACEHOLDERS)).toBe(true);
		expect(typeof api.checkSessionJsonlTermination).toBe("function");
	});
});
