/**
 * 测试 spawnOnce — extraEnv 参数透传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../subagent-utils", () => ({
	getPiCommand: vi.fn(() => ({ command: "node", args: ["/usr/local/bin/pi"] })),
}));

import { EventEmitter } from "node:events";

let mockProc: any;
const spawnCalls: any[][] = [];

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal() as any;
	return {
		...actual,
		spawn: (...args: any[]) => {
			spawnCalls.push(args);
			return mockProc;
		},
	};
});

import { spawnOnce, JSONL_CROSS_CHECK_DELAY_MS } from "../subagent-spawn-once";

/** 空占位 close 路径先等 JSONL_CROSS_CHECK_DELAY_MS 再 jsonl 交叉校验——fake timers 需推进过等待窗 */
async function emitCloseAndSettle(code: number): Promise<void> {
	mockProc.emit("close", code);
	await vi.advanceTimersByTimeAsync(JSONL_CROSS_CHECK_DELAY_MS);
}

function createMockProcess() {
	const proc = new EventEmitter() as any;
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();
	proc.killed = false;
	return proc;
}

describe("spawnOnce — extraEnv 透传", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockProc = createMockProcess();
		spawnCalls.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("不传 extraEnv 时 spawn env 为 process.env", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		await emitCloseAndSettle(0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		expect(spawnOpts.env).toBe(process.env);
	});

	it("传 extraEnv 时合并到 spawn env", async () => {
		const extraEnv = {
			PI_SUBAGENT_ORCHESTRATOR_TARGET: "my-session",
			PI_SUBAGENT_RUN_ID: "run-abc123",
			PI_SUBAGENT_CHILD_AGENT: "pv-executor",
			PI_SUBAGENT_CHILD_INDEX: "1",
		};
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, undefined, extraEnv);
		await emitCloseAndSettle(0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		// 语义修正（2026-11-24）：spawn env = process.env ∪ extraEnv，同名键以 extraEnv 为准。
		// 旧断言 objectContaining(process.env) 在键重叠时自相矛盾（子代理环境跑测试必红）。
		const nonOverlapEnv = Object.fromEntries(
			Object.entries(process.env).filter(([k]) => !(k in extraEnv)),
		);
		expect(spawnOpts.env).toEqual(expect.objectContaining(extraEnv));
		expect(spawnOpts.env).toEqual(expect.objectContaining(nonOverlapEnv));
	});

	it("extraEnv 的值覆盖 process.env 中同名 key", async () => {
		const extraEnv = { PATH: "/custom/path" };
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, undefined, extraEnv);
		await emitCloseAndSettle(0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		expect(spawnOpts.env.PATH).toBe("/custom/path");
	});

	it("extraEnv 为空对象时仍包含 process.env", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, undefined, {});
		await emitCloseAndSettle(0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		expect(spawnOpts.env).toEqual(expect.objectContaining(process.env));
	});
});
