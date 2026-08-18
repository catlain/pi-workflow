/**
 * 测试 createVisibleTaskDir — 可见模式临时目录与 launch.sh 生成
 *
 * extraEnv → export 行注入、单引号转义、Unix 路径转换、AUTO_EXIT 注入
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createVisibleTaskDir } from "../subagent-utils";

function cleanupDir(dir: string) {
	try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe("createVisibleTaskDir — launch.sh 生成", () => {
	it("extraEnv 写入 export 行", () => {
		const extraEnv = {
			PI_SUBAGENT_ORCHESTRATOR_TARGET: "my-session",
			PI_SUBAGENT_RUN_ID: "run-abc",
			PI_SUBAGENT_CHILD_AGENT: "pv-test",
			PI_SUBAGENT_CHILD_INDEX: "1",
		};
		const dir = createVisibleTaskDir("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, extraEnv);
		try {
			const script = fs.readFileSync(dir.launchScript, "utf-8");
			expect(script).toContain("export PI_SUBAGENT_ORCHESTRATOR_TARGET='my-session'");
			expect(script).toContain("export PI_SUBAGENT_RUN_ID='run-abc'");
			expect(script).toContain("export PI_SUBAGENT_CHILD_AGENT='pv-test'");
			expect(script).toContain("export PI_SUBAGENT_CHILD_INDEX='1'");
		} finally { cleanupDir(dir.taskDir); }
	});

	it("不传 extraEnv 时 launch.sh 不含 PI_SUBAGENT_*（桥接变量除外）", () => {
		const dir = createVisibleTaskDir("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] });
		try {
			const script = fs.readFileSync(dir.launchScript, "utf-8");
			expect(script).not.toContain("PI_SUBAGENT_ORCHESTRATOR_TARGET=");
			expect(script).toContain("export PI_SUBAGENT_AUTO_EXIT=1");
		} finally { cleanupDir(dir.taskDir); }
	});

	it("值含单引号时安全转义", () => {
		const dir = createVisibleTaskDir("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, undefined, { TEST_KEY: "it's a value" });
		try {
			const script = fs.readFileSync(dir.launchScript, "utf-8");
			expect(script).toContain("export TEST_KEY='it'\\''s a value'");
		} finally { cleanupDir(dir.taskDir); }
	});

	it("Windows 反斜杠路径转为 Unix 正斜杠", () => {
		const dir = createVisibleTaskDir("task", "C:\\Users\\test\\project", "/tmp/prompt.md", { tools: ["read"] });
		try {
			const script = fs.readFileSync(dir.launchScript, "utf-8");
			expect(script).toContain('cd "C:/Users/test/project"');
			expect(script).not.toContain("C:\\\\Users");
		} finally { cleanupDir(dir.taskDir); }
	});

	it("task 写入 task.txt，session 路径指向 taskDir", () => {
		const dir = createVisibleTaskDir("do the thing", "/cwd", "/tmp/prompt.md", { tools: ["read", "bash"] });
		try {
			expect(fs.readFileSync(dir.taskFile, "utf-8")).toBe("do the thing");
			expect(dir.sessionFile.startsWith(dir.taskDir)).toBe(true);
			expect(path.dirname(dir.launchScript)).toBe(dir.taskDir);
		} finally { cleanupDir(dir.taskDir); }
	});

	it("modelOverride 写入 --model 参数", () => {
		const dir = createVisibleTaskDir("task", "/cwd", "/tmp/prompt.md", { tools: ["read"] }, "zai/glm-5.2");
		try {
			const script = fs.readFileSync(dir.launchScript, "utf-8");
			expect(script).toContain("--model zai/glm-5.2");
		} finally { cleanupDir(dir.taskDir); }
	});
});
