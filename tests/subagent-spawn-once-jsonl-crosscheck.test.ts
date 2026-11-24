/**
 * 测试 spawnOnce close 分支的 jsonl 交叉校验
 *（opsx-subarch-cmds-late 7.3，spec: subagent-spawn-runtime「once 模式系统性失败 jsonl 交叉校验」）
 *
 * 法2 缺口：once 后台模式下子进程加载崩溃（如依赖丢失）经 bash 包装后 exitCode 报 0 且 stderr 为空，
 * F1 的 exitCode/stderr 判定失效，仍呈现 (no output) 假成功。修复把 visible 模式的 jsonl 信号源
 * 接入 once：空占位形态下先等 JSONL_CROSS_CHECK_DELAY_MS（孤儿进程 jsonl 尾刷容忍窗），
 * 再按 stdout 捕获的 sessionId 定位子会话文件、判定终结形态，异常则注入 error 归系统性失败档。
 *
 * 隔离：spawn 与 findSessionFileById 走 mock（定位函数自身的路径推导见 subagent-find-session-file.test.ts），
 * checkSessionJsonlTermination 走真实实现读临时文件——close 分支的判定逻辑与真实信号函数一起被覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EventEmitter } from "node:events";

const { findSessionFileByIdMock } = vi.hoisted(() => ({
	findSessionFileByIdMock: vi.fn<(sessionId: string | undefined, cwd: string) => string | undefined>(),
}));

vi.mock("../subagent-utils", () => ({
	getPiCommand: vi.fn(() => ({ command: "node", args: ["/usr/local/bin/pi"] })),
	findSessionFileById: findSessionFileByIdMock,
}));

let mockProc: any;
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal() as any;
	return {
		...actual,
		spawn: vi.fn(() => mockProc),
	};
});

import { spawnOnce, JSONL_CROSS_CHECK_DELAY_MS } from "../subagent-spawn-once";
import { isSystemicSubagentFailure, isSubagentSuccess } from "../utils";

const CWD = "/cwd";
const SOURCE = "once 模式信号源=jsonl 交叉校验";

function createMockProcess() {
	const proc = new EventEmitter() as any;
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	proc.kill = vi.fn();
	proc.killed = false;
	return proc;
}

function startOnce(signal?: AbortSignal) {
	return spawnOnce("task", CWD, "/tmp/prompt.md", { tools: ["read"] }, signal);
}

function emitSessionEvent(id: string) {
	mockProc.stdout.emit("data", Buffer.from(`{"type":"session","version":3,"id":"${id}"}\n`));
}

/** close + 推进过容忍窗（fake timers 下 Promise 才会落定） */
async function emitCloseAndSettle(code: number) {
	mockProc.emit("close", code);
	await vi.advanceTimersByTimeAsync(JSONL_CROSS_CHECK_DELAY_MS);
}

let tmpDir = "";

/** 写一个真实 session.jsonl：header + 可选 message 事件，返回路径 */
function writeSessionFile(id: string, withMessage: boolean): string {
	const filePath = path.join(tmpDir, `2026-11-25T00-00-00_${id}.jsonl`);
	const header = JSON.stringify({ type: "session", version: 3, id, cwd: CWD });
	const lines = [header];
	if (withMessage) {
		lines.push(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }));
	}
	fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
	return filePath;
}

beforeEach(() => {
	vi.useFakeTimers();
	mockProc = createMockProcess();
	// 显式重设返回值：vi.clearAllMocks 不清 mockReturnValue，避免用例间污染
	findSessionFileByIdMock.mockReset();
	findSessionFileByIdMock.mockReturnValue(undefined);
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-once-"));
});

afterEach(() => {
	vi.useRealTimers();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("spawnOnce close 分支：空占位形态的 jsonl 交叉校验", () => {
	it("① stdout 空 + 无 session 事件 + exitCode 0 → 注入 error（含「jsonl 交叉校验」「stdout 无 session 事件」），归系统性失败档", async () => {
		const resultPromise = startOnce();

		await emitCloseAndSettle(0);
		const result = await resultPromise;

		expect(result.exitCode).toBe(0); // exitCode 保持子进程原值
		expect(result.output).toBe("(no output)"); // 输出占位不变
		expect(result.error).toContain(SOURCE);
		expect(result.error).toContain("stdout 无 session 事件");
		expect(result.error).toContain("exitCode=0");
		expect(result.error).toContain("stderr 空");
		expect(findSessionFileByIdMock).not.toHaveBeenCalled(); // 无 sessionId 不查文件
		expect(isSystemicSubagentFailure(result)).toBe(true);
		expect(isSubagentSuccess(result)).toBe(false);
	});

	it("①' stderr 非空时 error 如实标注「非空」（不写死「空」）", async () => {
		const resultPromise = startOnce();
		mockProc.stderr.emit("data", Buffer.from("some warning"));

		await emitCloseAndSettle(0);
		const result = await resultPromise;

		expect(result.stderr).toBe("some warning");
		expect(result.error).toContain(SOURCE);
		expect(result.error).toContain("stderr 非空");
	});

	it("② jsonl 存在且含 message 事件 → 不注入 error（不误伤），维持现行为", async () => {
		findSessionFileByIdMock.mockReturnValue(writeSessionFile("sess-ok", true));
		const resultPromise = startOnce();
		emitSessionEvent("sess-ok");

		await emitCloseAndSettle(0);
		const result = await resultPromise;

		expect(findSessionFileByIdMock).toHaveBeenCalledWith("sess-ok", CWD);
		expect(result.error).toBeUndefined();
		expect(result.exitCode).toBe(0);
		expect(result.output).toBe("(no output)");
		expect(result.subSessionId).toBe("sess-ok");
		expect(isSystemicSubagentFailure(result)).toBe(false);
		expect(isSubagentSuccess(result)).toBe(true);
	});

	it("③ jsonl 存在但无 message 事件 → 注入 error（含 sessionId 与判定原因），归系统性失败档", async () => {
		findSessionFileByIdMock.mockReturnValue(writeSessionFile("sess-nomsg", false));
		const resultPromise = startOnce();
		emitSessionEvent("sess-nomsg");

		await emitCloseAndSettle(0);
		const result = await resultPromise;

		expect(result.error).toContain(SOURCE);
		expect(result.error).toContain("sess-nomsg");
		expect(result.error).toContain("无 message 事件");
		expect(isSystemicSubagentFailure(result)).toBe(true);
		expect(isSubagentSuccess(result)).toBe(false);
	});

	it("③' 有 session 事件但 session 文件缺失（定位未命中）→ 注入 error（含 sessionId 与「缺失」）", async () => {
		findSessionFileByIdMock.mockReturnValue(undefined);
		const resultPromise = startOnce();
		emitSessionEvent("sess-lost");

		await emitCloseAndSettle(0);
		const result = await resultPromise;

		expect(findSessionFileByIdMock).toHaveBeenCalledWith("sess-lost", CWD);
		expect(result.error).toContain(SOURCE);
		expect(result.error).toContain("sess-lost");
		expect(result.error).toContain("缺失");
		expect(isSystemicSubagentFailure(result)).toBe(true);
	});

	it("正常路径（有 assistant 文本）零变化：close 后立即 resolve，不等待、不交叉校验", async () => {
		const resultPromise = startOnce();
		emitSessionEvent("sess-text");
		mockProc.stdout.emit(
			"data",
			Buffer.from('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}\n'),
		);
		mockProc.emit("close", 0);

		// 不推进计时器，Promise 也应直接落定（未被容忍窗挂住）
		const result = await resultPromise;

		expect(result.output).toContain("hello");
		expect(result.error).toBeUndefined();
		expect(findSessionFileByIdMock).not.toHaveBeenCalled();
	});

	it("正文恰好含占位字面量的真实输出不触发交叉校验（触发条件=未收集到任何文本）", async () => {
		const resultPromise = startOnce();
		emitSessionEvent("sess-literal");
		mockProc.stdout.emit(
			"data",
			Buffer.from('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"result: (no output)"}]}}\n'),
		);
		mockProc.emit("close", 0);

		const result = await resultPromise;

		expect(result.output).toBe("result: (no output)");
		expect(result.error).toBeUndefined();
		expect(findSessionFileByIdMock).not.toHaveBeenCalled();
	});

	it("容忍窗：close 后窗口内不 resolve，推进到 JSONL_CROSS_CHECK_DELAY_MS（500）后才落定", async () => {
		expect(JSONL_CROSS_CHECK_DELAY_MS).toBe(500);
		const resultPromise = startOnce();
		let settled = false;
		void resultPromise.then(() => { settled = true; });

		mockProc.emit("close", 0);
		await vi.advanceTimersByTimeAsync(JSONL_CROSS_CHECK_DELAY_MS - 1);
		expect(settled).toBe(false);
		expect(findSessionFileByIdMock).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await resultPromise;
		expect(settled).toBe(true);
		await expect(resultPromise).resolves.toMatchObject({ error: expect.stringContaining(SOURCE) });
	});

	it("等待窗内被 abort 先行 resolve → 结果取 abort，交叉校验不覆盖", async () => {
		const controller = new AbortController();
		const resultPromise = startOnce(controller.signal);
		emitSessionEvent("sess-abort");
		mockProc.emit("close", 0);

		controller.abort();
		await vi.advanceTimersByTimeAsync(JSONL_CROSS_CHECK_DELAY_MS);
		const result = await resultPromise;

		expect(result.stderr).toContain("aborted");
		expect(result.error).toBeUndefined();
		expect(findSessionFileByIdMock).not.toHaveBeenCalled();
	});
});

describe("barrel 导出防回归", () => {
	it("crossCheckOnceSessionJsonl 经 index.ts 显式列名导出", async () => {
		const barrel = await import("../index");
		expect(typeof barrel.crossCheckOnceSessionJsonl).toBe("function");
		expect(typeof barrel.checkSessionJsonlTermination).toBe("function");
	});
});
