/**
 * Phase 2 额外测试：Agent 定义文件格式兼容性
 *
 * 验证 agent .md 文件的 frontmatter 与 parseFrontmatter 兼容，
 * 以及缺失字段时的边界行为。
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { parseFrontmatter } from "../research";

const AGENTS_DIR = path.join(os.homedir(), ".pi", "agent", "agents");

describe("Agent frontmatter 格式兼容性", () => {
  const agentFiles = [
    "_searcher.md",
    "_directions.md",
    "_source-eval.md",
    "_interpretation.md",
  ];

  for (const agentFile of agentFiles) {
    const filePath = path.join(AGENTS_DIR, agentFile);

    it(`${agentFile} 的 tools frontmatter 与 parseFrontmatter 兼容`, () => {
      // Skip if file doesn't exist
      if (!fs.existsSync(filePath)) return;

      const content = fs.readFileSync(filePath, "utf-8");
      const fm = parseFrontmatter(content);

      // tools 字段应包含至少一个工具名
      expect(fm.tools).toBeDefined();
      const toolsStr = String(fm.tools);
      expect(toolsStr.length).toBeGreaterThan(0);
      expect(toolsStr).toContain("read");
    });

    it(`${agentFile} 的 searcher 输出格式与 parseFrontmatter 兼容`, () => {
      if (!fs.existsSync(filePath)) return;

      const content = fs.readFileSync(filePath, "utf-8");

      // 验证 frontmatter 可以被 parseFrontmatter 正确解析
      const fm = parseFrontmatter(content);

      // 所有 agent 应有 tools 字段且不为空
      expect(fm.tools).toBeTruthy();
    });
  }

  it("searcher 输出格式中的 article.md frontmatter 可被 parseFrontmatter 正确解析", () => {
    // 模拟 searcher 输出格式描述中的 article.md 示例
    const articleContent = `---
url: https://arxiv.org/abs/2301.12345
title: Deep Learning for Factor Investing
score: 8
source_type: academic
found_at: "2026-05-09T12:00:00"
---
论文主要内容...`;

    const fm = parseFrontmatter(articleContent);
    expect(fm.url).toBe("https://arxiv.org/abs/2301.12345");
    expect(fm.title).toBe("Deep Learning for Factor Investing");
    expect(fm.score).toBe(8);
    expect(fm.source_type).toBe("academic");
    expect(fm.found_at).toBe("2026-05-09T12:00:00");
  });

  it("fixture 缺 score 的 article.md → 解析不崩溃", () => {
    // 模拟缺失 score 字段的 article.md
    const articleContent = `---
url: https://arxiv.org/abs/2301.67890
title: A Study Without Score
source_type: academic
found_at: "2026-05-09T12:00:00"
---
A paper without a numeric score`;

    // 解析不应崩溃
    const fm = parseFrontmatter(articleContent);
    expect(fm.url).toBe("https://arxiv.org/abs/2301.67890");
    expect(fm.title).toBe("A Study Without Score");
    // score 应为 undefined（而非 NaN 或崩溃）
    expect(fm.score).toBeUndefined();
  });

  it("fixture 缺多个字段的 article.md → 解析不崩溃", () => {
    // 模拟只含 URL 的极简 article.md
    const articleContent = `---
url: https://example.com/bare-minimum
---
Just a URL`;

    const fm = parseFrontmatter(articleContent);
    expect(fm.url).toBe("https://example.com/bare-minimum");
    // 缺失字段应为 undefined
    expect(fm.title).toBeUndefined();
    expect(fm.score).toBeUndefined();
    expect(fm.source_type).toBeUndefined();
    expect(fm.found_at).toBeUndefined();
  });
});
