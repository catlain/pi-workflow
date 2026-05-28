/**
 * Tests: agent-loader.ts — loadAgentDef + parseAgentFile + 缓存行为
 *
 * 测试场景（12 用例）：
 * 1) 加载存在带 frontmatter 的 agent 文件 → 返回完整 AgentDef
 * 2) 加载存在无 frontmatter 的 agent 文件 → body 作为 systemPrompt
 * 3) 加载不存在的 agent → 返回 null
 * 4) 搜索两个路径（.pi/agent/agents 和 .agents/agents）
 * 5) 缓存命中（mtime 未变）→ 不重新读文件
 * 6) 缓存过期（mtime 改变）→ 重新读文件
 * 7) frontmatter 解析：name/tools/model/thinking 字段
 * 8) tools 逗号分隔
 * 9) 引号移除
 * 10) 无 tools 字段 → 默认 tools
 * 11) 空 body 情况
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

const MOCK_HOME = "/home/testuser";

// Track readFileSync call count
let readFileCallCount = 0;

vi.mock("node:os", () => ({ homedir: () => MOCK_HOME }));

const mockFiles = new Map<string, { content: string; mtimeMs: number }>();

vi.mock("node:fs", () => ({
	existsSync: (p: string) => mockFiles.has(p),
	statSync: (p: string) => {
		const entry = mockFiles.get(p);
		if (!entry) throw new Error(`ENOENT: ${p}`);
		return { mtimeMs: entry.mtimeMs };
	},
	readFileSync: (p: string, _encoding?: any) => {
		readFileCallCount++;
		const entry = mockFiles.get(p);
		if (!entry) throw new Error(`ENOENT: ${p}`);
		return entry.content;
	},
	promises: {},
}));

function addMockFile(fullRelPath: string, content: string, mtimeMs: number = 1000) {
	mockFiles.set(path.join(MOCK_HOME, fullRelPath), { content, mtimeMs });
}

import { loadAgentDef } from "../agent-loader";

describe("loadAgentDef", () => {
	beforeEach(() => {
		mockFiles.clear();
		readFileCallCount = 0;
	});

	it("加载存在带 frontmatter 的 agent → 返回完整 AgentDef", () => {
		addMockFile(".pi/agent/agents/reviewer.md",
			"---\nname: reviewer\ntools: read,grep,find\nmodel: gpt-4\nthinking: auto\n---\n你是一个 code reviewer。",
		);
		const def = loadAgentDef("reviewer");
		expect(def).not.toBeNull();
		expect(def!.name).toBe("reviewer");
		expect(def!.tools).toEqual(["read", "grep", "find"]);
		expect(def!.model).toBe("gpt-4");
		expect(def!.thinking).toBe("auto");
		expect(def!.systemPrompt).toBe("你是一个 code reviewer。");
	});

	it("加载存在无 frontmatter 的 agent → body 作为 systemPrompt，默认 tools", () => {
		addMockFile(".pi/agent/agents/simple.md", "你是一个简单的 agent，不做任何工具调用。");
		const def = loadAgentDef("simple");
		expect(def).not.toBeNull();
		expect(def!.name).toBe("simple");
		expect(def!.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(def!.systemPrompt).toBe("你是一个简单的 agent，不做任何工具调用。");
		expect(def!.model).toBeUndefined();
	});

	it("加载不存在 agent → 返回 null", () => {
		const def = loadAgentDef("nonexistent");
		expect(def).toBeNull();
	});

	it("优先搜索 .pi/agent/agents，再搜索 .agents/agents", () => {
		addMockFile(".agents/agents/fallback.md", "Fallback agent");
		const def = loadAgentDef("fallback");
		expect(def).not.toBeNull();
		expect(def!.systemPrompt).toBe("Fallback agent");
	});

	it("第一路径存在时，不使用第二路径", () => {
		addMockFile(".pi/agent/agents/dup.md", "Primary version");
		addMockFile(".agents/agents/dup.md", "Secondary version");
		const def = loadAgentDef("dup");
		expect(def).not.toBeNull();
		expect(def!.systemPrompt).toBe("Primary version");
	});

	it("缓存命中（mtime 未变）→ 只读一次文件", () => {
		addMockFile(".pi/agent/agents/cached.md",
			"---\nname: cached\ntools: read\n---\nContent",
			1000,
		);
		// First call — load and cache
		const def1 = loadAgentDef("cached");
		expect(def1).not.toBeNull();
		const callsAfterFirst = readFileCallCount;

		// Second call — should use cache
		const def2 = loadAgentDef("cached");
		expect(def2).not.toBeNull();
		expect(readFileCallCount).toBe(callsAfterFirst);
	});

	it("缓存过期（mtime 改变）→ 重新读文件", () => {
		addMockFile(".pi/agent/agents/outdated.md",
			"---\nname: outdated\ntools: read\n---\nOld",
			1000,
		);
		// First call — populate cache
		loadAgentDef("outdated");
		const callsAfterFirst = readFileCallCount;

		// Update file mtime and content
		addMockFile(".pi/agent/agents/outdated.md",
			"---\nname: outdated\ntools: read,grep\n---\nNew",
			2000,
		);

		const def = loadAgentDef("outdated");
		expect(def).not.toBeNull();
		expect(def!.tools).toEqual(["read", "grep"]);
		expect(def!.systemPrompt).toBe("New");
		expect(readFileCallCount).toBe(callsAfterFirst + 1);
	});

	it("frontmatter 解析：引号去除", () => {
		addMockFile(".pi/agent/agents/quoted.md",
			`---\nname: "quoted-agent"\ntools: "read,grep"\nmodel: 'gpt-4'\n---\nPrompt body`,
		);
		const def = loadAgentDef("quoted");
		expect(def).not.toBeNull();
		expect(def!.name).toBe("quoted-agent");
		expect(def!.tools).toEqual(["read", "grep"]);
		expect(def!.model).toBe("gpt-4");
	});

	it("无 tools 字段 → 默认 tools", () => {
		addMockFile(".pi/agent/agents/notools.md", "---\nname: notools\n---\nJust a prompt");
		const def = loadAgentDef("notools");
		expect(def).not.toBeNull();
		expect(def!.tools).toEqual(["read", "grep", "find", "ls"]);
	});

	it("tools 逗号分隔含空格 → 正确 trim", () => {
		addMockFile(".pi/agent/agents/trimmed.md",
			"---\nname: trimmed\ntools: read , grep , find\n---\nContent",
		);
		const def = loadAgentDef("trimmed");
		expect(def).not.toBeNull();
		expect(def!.tools).toEqual(["read", "grep", "find"]);
	});

	it("不带 frontmatter 且 body 为空 → body 用 content.trim()", () => {
		addMockFile(".pi/agent/agents/emptybody.md", "   \n  \n");
		const def = loadAgentDef("emptybody");
		expect(def).not.toBeNull();
		expect(def!.systemPrompt).toBe("");
	});

	it("frontmatter 有额外未知字段 → 忽略，不报错", () => {
		addMockFile(".pi/agent/agents/extra.md",
			"---\nname: extra\ntools: read\nunknown_field: hello\n---\nContent",
		);
		const def = loadAgentDef("extra");
		expect(def).not.toBeNull();
		expect(def!.name).toBe("extra");
		expect(def!.tools).toEqual(["read"]);
		expect(def!.systemPrompt).toBe("Content");
	});
});
