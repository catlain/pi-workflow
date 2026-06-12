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

import { spawnOnce } from "../subagent-spawn-once";

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
		mockProc.emit("close", 0);
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
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, extraEnv);
		mockProc.emit("close", 0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		expect(spawnOpts.env).toEqual(expect.objectContaining(extraEnv));
		expect(spawnOpts.env).toEqual(expect.objectContaining(process.env));
	});

	it("extraEnv 的值覆盖 process.env 中同名 key", async () => {
		const extraEnv = { PATH: "/custom/path" };
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, extraEnv);
		mockProc.emit("close", 0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		expect(spawnOpts.env.PATH).toBe("/custom/path");
	});

	it("extraEnv 为空对象时仍包含 process.env", async () => {
		const resultPromise = spawnOnce("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, undefined, undefined, undefined, {});
		mockProc.emit("close", 0);
		await resultPromise;

		const spawnOpts = spawnCalls[0][2];
		expect(spawnOpts.env).toEqual(expect.objectContaining(process.env));
	});
});
