import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock paths 模块
vi.mock("../paths", () => ({
	AGENT_DIR: "/test/agent",
	AGENTS_DIR: "/test/agent/agents",
}));

// Mock fs
vi.mock("node:fs", () => ({
	existsSync: vi.fn(),
	readdirSync: vi.fn(),
	readFileSync: vi.fn(),
}));

const { discoverAgents, getAgentDescription } = await import("../agents");
const existsSync = vi.mocked(fs.existsSync);
const readdirSync = vi.mocked(fs.readdirSync);
const readFileSync = vi.mocked(fs.readFileSync);

describe("agents", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("discoverAgents", () => {
		it("目录不存在时返回空数组", () => {
			existsSync.mockReturnValue(false);
			expect(discoverAgents()).toEqual([]);
		});

		it("过滤 .md 文件，排除 _ 开头的", () => {
			existsSync.mockReturnValue(true);
			readdirSync.mockReturnValue(["fr-searcher.md", "_helper.md", "fo-analyzer.md", "ignore.txt"] as any);
			expect(discoverAgents()).toEqual(["fr-searcher", "fo-analyzer"]);
		});
	});

	describe("getAgentDescription", () => {
		it("从 frontmatter 提取 description", () => {
			readFileSync.mockReturnValue("---\ndescription: 这是一个测试代理\n---\n# body");
			expect(getAgentDescription("test-agent")).toBe("这是一个测试代理");
		});

		it("没有 frontmatter 时返回默认描述", () => {
			readFileSync.mockReturnValue("# no frontmatter");
			expect(getAgentDescription("test-agent")).toBe("read, grep, find, ls");
		});

		it("读取失败时返回默认描述", () => {
			readFileSync.mockImplementation(() => { throw new Error("not found"); });
			expect(getAgentDescription("missing")).toBe("read, grep, find, ls");
		});
	});
});
