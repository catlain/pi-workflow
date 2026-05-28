/**
 * Tests: subagent-utils.ts — getPiCommand + writeTempPrompt
 *
 * 测试场景（7 用例）：
 * 1) argv[1] 文件存在 → execPath + argv[1]
 * 2) argv[1] 文件不存在 + execPath=node → pi
 * 3) argv[1] undefined → pi
 * 4) argv[1] bun virtual → pi
 * 5) execPath 非 node/bun → execPath
 * 6) writeTempPrompt 创建文件
 * 7) writeTempPrompt 内容正确
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ---- mock fs.existsSync using a mutable flag ----
let mockExistsResult = true;
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		existsSync: (p: string) => {
			// For the specific test path, use mock; for everything else, use real
			if (p === "/mock/exists/script.ts" || p === "/mock/not-exists/script.ts") {
				return mockExistsResult;
			}
			return actual.existsSync(p);
		},
	};
});

// Mock os.tmpdir for writeTempPrompt
vi.mock("node:os", () => ({ tmpdir: () => "/tmp", default: { tmpdir: () => "/tmp" } }));

function setArgv(argv1?: string) {
	const base = process.argv[0] || "/usr/bin/node";
	const arr = argv1 !== undefined ? [base, argv1] : [base];
	Object.defineProperty(process, "argv", { value: arr, configurable: true });
}

function setExecPath(p: string) {
	Object.defineProperty(process, "execPath", { value: p, configurable: true });
}

import { getPiCommand, writeTempPrompt } from "../subagent-utils";

describe("getPiCommand", () => {
	const origArgv = process.argv;
	const origExecPath = process.execPath;

	afterEach(() => {
		Object.defineProperty(process, "argv", { value: origArgv, configurable: true });
		Object.defineProperty(process, "execPath", { value: origExecPath, configurable: true });
	});

	it("argv[1] 文件存在 → execPath + argv[1]", () => {
		setArgv("/mock/exists/script.ts");
		setExecPath("/usr/bin/node");
		mockExistsResult = true;
		const result = getPiCommand();
		expect(result.command).toBe("/usr/bin/node");
		expect(result.args).toEqual(["/mock/exists/script.ts"]);
	});

	it("argv[1] 文件不存在 + execPath=node → pi", () => {
		setArgv("/mock/not-exists/script.ts");
		setExecPath("/usr/bin/node");
		mockExistsResult = false;
		const result = getPiCommand();
		expect(result.command).toBe("pi");
		expect(result.args).toEqual([]);
	});

	it("argv[1] 为 undefined → pi", () => {
		setArgv(undefined);
		setExecPath("/usr/bin/node");
		mockExistsResult = false;
		const result = getPiCommand();
		expect(result.command).toBe("pi");
		expect(result.args).toEqual([]);
	});

	it("argv[1] 是 bun virtual script → pi", () => {
		setArgv("/$bunfs/root/some/script.ts");
		setExecPath("/usr/bin/bun");
		const result = getPiCommand();
		expect(result.command).toBe("pi");
		expect(result.args).toEqual([]);
	});

	it("execPath 不是 node/bun 且 argv[1] 不存在 → execPath", () => {
		setArgv("/mock/not-exists/script.ts");
		setExecPath("/usr/local/bin/python3");
		mockExistsResult = false;
		const result = getPiCommand();
		expect(result.command).toBe("/usr/local/bin/python3");
		expect(result.args).toEqual([]);
	});
});

describe("writeTempPrompt", () => {
	it("创建临时目录和文件，返回正确路径", async () => {
		const result = await writeTempPrompt("test content");
		expect(result).toMatch(/pi-pv-/);
		expect(result).toMatch(/system-prompt\.md$/);
		// Cleanup
		const dir = path.dirname(result);
		fs.unlinkSync(result);
		fs.rmdirSync(dir);
	});

	it("文件内容正确写入", async () => {
		const content = "Hello, World!";
		const result = await writeTempPrompt(content);
		const written = fs.readFileSync(result, "utf-8");
		expect(written).toBe(content);
		// Cleanup
		const dir = path.dirname(result);
		fs.unlinkSync(result);
		fs.rmdirSync(dir);
	});
});
