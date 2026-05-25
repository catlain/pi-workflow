/**
 * Phase 1 额外测试：fixture 格式兼容性、缺失字段、损坏内容
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  parseFrontmatter,
  scanNewSources,
  type Article,
} from "../research";

describe("parseFrontmatter — 补充测试", () => {
  it("should parse all fields from a complete frontmatter fixture", () => {
    const content = `---
url: https://arxiv.org/abs/2301.12345
title: Deep Learning for Factor Investing
score: 8
source_type: academic
found_at: "2026-05-09T12:00:00"
---
This paper explores deep learning approaches...`;

    const fm = parseFrontmatter(content);
    expect(fm.url).toBe("https://arxiv.org/abs/2301.12345");
    expect(fm.title).toBe("Deep Learning for Factor Investing");
    expect(fm.score).toBe(8);
    expect(fm.source_type).toBe("academic");
    expect(fm.found_at).toBe("2026-05-09T12:00:00");
  });

  it("should handle missing score field gracefully (return undefined)", () => {
    const content = `---
url: https://example.com/article
title: Test Article
source_type: blog
found_at: "2026-05-09T12:00:00"
---
Content without score`;

    const fm = parseFrontmatter(content);
    expect(fm.url).toBe("https://example.com/article");
    expect(fm.title).toBe("Test Article");
    expect(fm.source_type).toBe("blog");
    expect(fm.score).toBeUndefined();
    expect(fm.found_at).toBe("2026-05-09T12:00:00");
  });

  it("should handle missing title and found_at fields", () => {
    const content = `---
url: https://example.com/minimal
score: 6
---
Just URL and score`;

    const fm = parseFrontmatter(content);
    expect(fm.url).toBe("https://example.com/minimal");
    expect(fm.score).toBe(6);
    expect(fm.title).toBeUndefined();
    expect(fm.found_at).toBeUndefined();
  });

  it("should handle corrupted frontmatter (illegal YAML-like content)", () => {
    // 首页有 --- 分隔符，但内容是非法 YAML（二进制、冒号过多等）
    const content = `---
url: https://example.com
: : bad : yaml : : :
value: :colon: explosion
binary: \\x00\\x01\\x02
---
Some content`;

    // 不应崩溃，应返回可解析的字段
    const fm = parseFrontmatter(content);
    // 至少 url 应该被解析
    expect(fm.url).toBe("https://example.com");
  });

  it("should handle frontmatter with unusual whitespace", () => {
    const content = `---
url:    https://example.com/spaced
title:   "Title with   spaces"
score:    7
source_type:  academic
found_at: "2026-05-09T12:00:00"
---
Content`;

    const fm = parseFrontmatter(content);
    expect(fm.url).toBe("https://example.com/spaced");
    expect(fm.title).toBe("Title with   spaces");
    expect(fm.score).toBe(7);
    expect(fm.source_type).toBe("academic");
  });
});

describe("scanNewSources — 缺失 score 行为", () => {
  let tmpDir: string;
  let topicDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-extra-"));
    // scanNewSources 使用 getResearchDir(cwd) = cwd/docs/research
    topicDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(topicDir, "docs", "research", "sources", "arxiv"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should assign default score 5 when frontmatter has no score", () => {
    const content = `---
url: https://example.com/no-score
title: No Score Article
source_type: blog
---
Content without score`;

    fs.writeFileSync(
      path.join(topicDir, "docs", "research", "sources", "arxiv", "2026-05-09T1200_article.md"),
      content,
    );

    const articles = scanNewSources(topicDir, []);
    expect(articles).toHaveLength(1);
    expect(articles[0].score).toBe(5); // default
    expect(articles[0].url).toBe("https://example.com/no-score");
  });

  it("should handle corrupted article file without crashing", () => {
    // 没有 frontmatter 分隔符
    fs.writeFileSync(
      path.join(topicDir, "docs", "research", "sources", "arxiv", "corrupted.md"),
      "This is just plain text without any frontmatter",
    );

    // 不应崩溃，应返回空数组
    const articles = scanNewSources(topicDir, []);
    expect(articles).toEqual([]);
  });

  it("should handle binary garbage file without crashing", () => {
    const garbage = Buffer.alloc(100, 0xff);
    fs.writeFileSync(
      path.join(topicDir, "docs", "research", "sources", "arxiv", "garbage.bin"),
      garbage,
    );

    // 不匹配 *_article.md 模式，所以应被忽略
    const articles = scanNewSources(topicDir, []);
    expect(articles).toEqual([]);
  });

  it("should skip article with empty URL even when other fields exist", () => {
    const content = `---
url: ""
title: Empty URL Article
score: 7
source_type: academic
---
Content with empty URL`;

    fs.writeFileSync(
      path.join(topicDir, "docs", "research", "sources", "arxiv", "2026-05-09T1200_article.md"),
      content,
    );

    const articles = scanNewSources(topicDir, []);
    expect(articles).toHaveLength(0);
  });
});
