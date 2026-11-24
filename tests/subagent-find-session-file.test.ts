/**
 * 测试 findSessionFileById 抽取（opsx-subarch-cmds-late 7.1，spec: subagent-spawn-runtime「定位函数可复用」）
 *
 * 覆盖：
 * 1. 路径推导行为锁死（从 findAndInjectParentSession 抽出，零变化）：
 *    PI_CODING_AGENT_SESSION_DIR 覆盖 + cwd slug 子目录 + 首行 header.id 匹配 + 最近 20 个文件窗口 + 容错
 * 2. 既有调用方 findAndInjectParentSession 经新函数定位后行为等价：
 *    命中注入到同一文件 / 已有 parentSession 不覆盖 / 未命中不触碰 / 参数为空直接返回
 *
 * 用真实临时目录（只读定位与首行注入都走真实 fs）。cwd 用 Unix 风格假路径，slug 目录按被测函数
 * 自身的推导公式布局——这部分锁的是「抽取前后行为一致」。
 *
 * Windows 布局一致性（Q1-A 根因修，opsx-subarch-cmds-late）：slug 公式与 pi SDK
 * session-manager 逐字同式（/ 与 \ 与盘符冒号全部换 -）。目录名用 **实际观测值**硬编码
 * （ls ~/.pi/agent/sessions/ 实证），不依赖被测函数推导——锁的是「与 pi 真实目录布局一致」。
 * 修复前 Windows 下永远不命中：once 模式 jsonl 交叉校验会把「子代理合法跑完但零文本输出」
 * 误报为 jsonl 缺失。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findSessionFileById, findAndInjectParentSession } from "../subagent-utils";

const CWD = "/proj/x";
const PARENT = "/sessions/parent.jsonl";
const FILE_PREFIX = "2026-11-25T00-00-00";

let sessionRoot = "";
let prevEnv: string | undefined;

/** Windows 实际布局：cwd 与 pi 写出的 slug 目录名（观测值，不推导） */
const WIN_CWD = "C:\\Users\\Administrator\\.pi\\agent\\git\\github.com\\catlain";
const WIN_CWD_FORWARD = "C:/Users/Administrator/.pi/agent/git/github.com/catlain";
const WIN_SLUG = "--C--Users-Administrator-.pi-agent-git-github.com-catlain--";

function makeSessionDirAt(slug: string): string {
	const dir = path.join(sessionRoot, slug);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function makeSessionDir(cwd: string = CWD): string {
	// Unix 组仅用 CWD 一个值；期望目录名硬编码（观测自 pi SDK slug 公式），不复制被测公式
	// ——复制公式会让测试随实现一起漂移，锁不住回归。
	const expected: Record<string, string> = { [CWD]: "--proj-x--", "/proj/other": "--proj-other--" };
	const dir = path.join(sessionRoot, expected[cwd] ?? `__unexpected_cwd__:${cwd}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

/** 写一个两行 session 文件（header + message），返回路径 */
function writeSessionFile(dir: string, id: string, extra: Record<string, unknown> = {}): string {
	const filePath = path.join(dir, `${FILE_PREFIX}_${id}.jsonl`);
	const header = JSON.stringify({ type: "session", version: 3, id, cwd: CWD, ...extra });
	const body = JSON.stringify({ type: "message", message: { role: "user", content: [] } });
	fs.writeFileSync(filePath, `${header}\n${body}\n`, "utf-8");
	return filePath;
}

function readHeader(filePath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(filePath, "utf-8").split("\n")[0]);
}

beforeEach(() => {
	sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-wf-sess-"));
	prevEnv = process.env.PI_CODING_AGENT_SESSION_DIR;
	process.env.PI_CODING_AGENT_SESSION_DIR = sessionRoot;
});

afterEach(() => {
	if (prevEnv === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
	else process.env.PI_CODING_AGENT_SESSION_DIR = prevEnv;
	fs.rmSync(sessionRoot, { recursive: true, force: true });
});

describe("findSessionFileById：路径推导行为锁死（抽取零变化）", () => {
	it("命中：slug 目录内首行 header.id 匹配 → 返回该文件路径（非匹配文件跳过）", () => {
		const dir = makeSessionDir();
		writeSessionFile(dir, "sess-other");
		const target = writeSessionFile(dir, "sess-hit");
		expect(findSessionFileById("sess-hit", CWD)).toBe(target);
	});

	it("命中：只看首行 header.id（id 出现在后续行不算）", () => {
		const dir = makeSessionDir();
		const filePath = path.join(dir, "a.jsonl");
		const header = JSON.stringify({ type: "session", version: 3, id: "sess-a" });
		const later = JSON.stringify({ type: "session_info", id: "sess-b" });
		fs.writeFileSync(filePath, `${header}\n${later}\n`, "utf-8");
		expect(findSessionFileById("sess-b", CWD)).toBeUndefined();
		expect(findSessionFileById("sess-a", CWD)).toBe(filePath);
	});

	it("命中：只查最近 20 个文件——目标 mtime 最旧排第 21 → 未命中；窗口内文件照常命中", () => {
		const dir = makeSessionDir();
		const oldest = writeSessionFile(dir, "sess-oldest");
		for (let i = 0; i < 20; i++) writeSessionFile(dir, `sess-${i}`);
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(oldest, old, old);
		expect(findSessionFileById("sess-oldest", CWD)).toBeUndefined();
		expect(findSessionFileById("sess-19", CWD)).toBe(path.join(dir, `${FILE_PREFIX}_sess-19.jsonl`));
	});

	it("容错：候选文件首行非 JSON / 首行超 500 字节截断 → 跳过不抛，继续找后续文件", () => {
		const dir = makeSessionDir();
		fs.writeFileSync(path.join(dir, "0_broken.jsonl"), "not json at all\n", "utf-8");
		fs.writeFileSync(path.join(dir, "1_huge.jsonl"), `{"type":"session","id":"${"x".repeat(600)}"}\n`, "utf-8");
		const target = writeSessionFile(dir, "sess-after-broken");
		expect(findSessionFileById("sess-after-broken", CWD)).toBe(target);
	});

	it("未命中：slug 目录内无匹配 id → undefined", () => {
		const dir = makeSessionDir();
		writeSessionFile(dir, "sess-other");
		expect(findSessionFileById("sess-missing", CWD)).toBeUndefined();
	});

	it("未命中：cwd 对应 slug 目录不存在 → undefined（另一 cwd 的目录不串查）", () => {
		writeSessionFile(makeSessionDir("/proj/other"), "sess-hit");
		expect(findSessionFileById("sess-hit", CWD)).toBeUndefined();
	});

	it("未命中：sessionId 为 undefined / 空串 → undefined（base 目录缺失也不抛）", () => {
		fs.rmSync(sessionRoot, { recursive: true, force: true });
		expect(findSessionFileById(undefined, CWD)).toBeUndefined();
		expect(findSessionFileById("", CWD)).toBeUndefined();
	});

	it("未命中：base 目录（PI_CODING_AGENT_SESSION_DIR）不存在 → undefined 不抛", () => {
		fs.rmSync(sessionRoot, { recursive: true, force: true });
		expect(findSessionFileById("sess-hit", CWD)).toBeUndefined();
	});
});

describe("Windows 目录布局一致性（Q1-A：slug 与 pi SDK 同式）", () => {
	it("盘符冒号与反斜杠全部换 - → 命中 pi 实际写入的目录", () => {
		const dir = makeSessionDirAt(WIN_SLUG);
		const target = writeSessionFile(dir, "sess-win");
		expect(findSessionFileById("sess-win", WIN_CWD)).toBe(target);
	});

	it("cwd 用正斜杠写法 → 同一目录（两种分隔符推导结果一致）", () => {
		const dir = makeSessionDirAt(WIN_SLUG);
		const target = writeSessionFile(dir, "sess-win");
		expect(findSessionFileById("sess-win", WIN_CWD_FORWARD)).toBe(target);
	});

	it("修复前形态锁死：旧公式（仅换 /，保留盘符冒号）算出的目录不是查找目标", () => {
		// 旧目录名含 ':'——Windows 禁止目录名含冒号（mkdir 必 ENOENT），物理上不可能存在；
		// 因此不断言"旧目录里的文件不被找到"，改断言"对修复前的 cwd 变换结果不命中":
		// 旧公式对 WIN_CWD 的输出形如 --C:-Users-…（冒号保留），新公式必不落到该名字。
		expect(findSessionFileById("sess-win", WIN_CWD)).toBeUndefined();
		// 对照：正确目录建好后同一调用命中——证明 undefined 来自目录名不匹配，而非调用本身失效
		const dir = makeSessionDirAt(WIN_SLUG);
		const target = writeSessionFile(dir, "sess-win");
		expect(findSessionFileById("sess-win", WIN_CWD)).toBe(target);
	});

	it("Unix 路径行为不变：仅去单个前导 /，后续 / 换 -", () => {
		const dir = makeSessionDirAt("--proj-x--");
		const target = writeSessionFile(dir, "sess-u");
		expect(findSessionFileById("sess-u", "/proj/x")).toBe(target);
		// 前导 // 只去一个（与 SDK 一致，不吞第二个分隔符）
		expect(findSessionFileById("sess-u", "//proj/x")).toBeUndefined();
	});

	it("调用方连带生效：Windows cwd 下 parentSession 注入到正确文件", () => {
		const dir = makeSessionDirAt(WIN_SLUG);
		const target = writeSessionFile(dir, "sess-win");
		findAndInjectParentSession("sess-win", PARENT, WIN_CWD);
		expect(readHeader(target).parentSession).toBe(PARENT);
	});
});

describe("findAndInjectParentSession 经 findSessionFileById 定位（调用方行为零变化）", () => {
	it("命中：parentSession 注入到 findSessionFileById 返回的同一文件，其他文件不动", () => {
		const dir = makeSessionDir();
		const other = writeSessionFile(dir, "sess-other");
		const target = writeSessionFile(dir, "sess-hit");
		findAndInjectParentSession("sess-hit", PARENT, CWD);
		expect(findSessionFileById("sess-hit", CWD)).toBe(target);
		expect(readHeader(target).parentSession).toBe(PARENT);
		expect(readHeader(other).parentSession).toBeUndefined();
		// 只改首行：后续行原样保留
		const lines = fs.readFileSync(target, "utf-8").split("\n");
		expect(lines[1]).toContain('"type":"message"');
	});

	it("命中但 header 已有 parentSession → 不覆盖（injectParentSession 既有语义）", () => {
		const dir = makeSessionDir();
		const target = writeSessionFile(dir, "sess-hit", { parentSession: "/sessions/first.jsonl" });
		findAndInjectParentSession("sess-hit", PARENT, CWD);
		expect(readHeader(target).parentSession).toBe("/sessions/first.jsonl");
	});

	it("未命中：不触碰任何文件", () => {
		const dir = makeSessionDir();
		const other = writeSessionFile(dir, "sess-other");
		const before = fs.readFileSync(other, "utf-8");
		findAndInjectParentSession("sess-missing", PARENT, CWD);
		expect(fs.readFileSync(other, "utf-8")).toBe(before);
		expect(readHeader(other).parentSession).toBeUndefined();
	});

	it("sessionId 或 parentPath 为空 → 直接返回，不定位", () => {
		const dir = makeSessionDir();
		const target = writeSessionFile(dir, "sess-hit");
		findAndInjectParentSession(undefined, PARENT, CWD);
		findAndInjectParentSession("", PARENT, CWD);
		findAndInjectParentSession("sess-hit", "", CWD);
		expect(readHeader(target).parentSession).toBeUndefined();
	});
});
