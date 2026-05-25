/**
 * research.ts 测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  slugify,
  urlToId,
  parseFrontmatter,
  getTimestamp,
  loadCatalog,
  saveCatalog,
  loadTopicState,
  saveTopicState,
  scanNewSources,
  getTopicDir,
  type Article,
} from "../research";

describe("slugify", () => {
  it("should convert spaces to hyphens", () => {
    expect(slugify("Momentum Crash Factor")).toBe("momentum-crash-factor");
  });

  it("should handle Chinese characters", () => {
    expect(slugify("A股 波动率因子")).toBe("a股-波动率因子");
  });

  it("should trim and lowercase", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("should strip special characters", () => {
    expect(slugify("Factor #1 (test)")).toBe("factor-1-test");
  });

  it("should collapse multiple hyphens", () => {
    expect(slugify("a   b---c")).toBe("a-b-c");
  });

  it("should return empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });
});

describe("urlToId", () => {
  it("should return consistent 12-char hash", () => {
    const id1 = urlToId("https://example.com/article1");
    const id2 = urlToId("https://example.com/article1");
    expect(id1).toBe(id2);
    expect(id1.length).toBe(12);
  });

  it("should produce different IDs for different URLs", () => {
    const id1 = urlToId("https://example.com/a");
    const id2 = urlToId("https://example.com/b");
    expect(id1).not.toBe(id2);
  });

  it("should handle empty string", () => {
    const id = urlToId("");
    expect(id.length).toBe(12);
  });
});

describe("parseFrontmatter", () => {
  it("should parse string fields", () => {
    const content = `---
url: https://example.com
title: Test Article
source_type: academic
---
Content here`;
    const fm = parseFrontmatter(content);
    expect(fm.url).toBe("https://example.com");
    expect(fm.title).toBe("Test Article");
    expect(fm.source_type).toBe("academic");
  });

  it("should parse numeric fields", () => {
    const content = `---
score: 8
---
Content`;
    const fm = parseFrontmatter(content);
    expect(fm.score).toBe(8);
  });

  it("should parse float fields", () => {
    const content = `---
score: 7.5
---
Content`;
    const fm = parseFrontmatter(content);
    expect(fm.score).toBe(7.5);
  });

  it("should parse boolean fields", () => {
    const content = `---
reviewed: true
published: false
---
Content`;
    const fm = parseFrontmatter(content);
    expect(fm.reviewed).toBe(true);
    expect(fm.published).toBe(false);
  });

  it("should parse quoted values", () => {
    const content = `---
title: "Hello: World"
---
Content`;
    const fm = parseFrontmatter(content);
    expect(fm.title).toBe("Hello: World");
  });

  it("should return empty object when no frontmatter", () => {
    const fm = parseFrontmatter("Just content without frontmatter");
    expect(fm).toEqual({});
  });

  it("should handle empty frontmatter", () => {
    const content = `---
---
Content`;
    const fm = parseFrontmatter(content);
    expect(fm).toEqual({});
  });

  it("should handle ISO datetime in found_at", () => {
    const content = `---
found_at: "2026-05-09T12:00:00"
---
Content`;
    const fm = parseFrontmatter(content);
    expect(fm.found_at).toBe("2026-05-09T12:00:00");
  });
});

describe("getTimestamp", () => {
  it("should return format YYYY-MM-DDTHHmm", () => {
    const ts = getTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{4}$/);
  });
});

describe("loadCatalog / saveCatalog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty array when no catalog exists", () => {
    const catalog = loadCatalog(tmpDir);
    expect(catalog).toEqual([]);
  });

  it("should save and load catalog", () => {
    const articles: Article[] = [
      {
        id: "abc123def456",
        url: "https://example.com/1",
        title: "Test Article 1",
        source_type: "academic",
        found_at: "2026-05-09T12:00:00",
        score: 8,
        dir: "sources/arxiv/",
        file: "2026-05-09T1200_article.md",
      },
    ];

    saveCatalog(tmpDir, articles);
    const loaded = loadCatalog(tmpDir);
    expect(loaded).toEqual(articles);
  });

  it("should overwrite existing catalog", () => {
    saveCatalog(tmpDir, [
      { id: "1", url: "a", title: "A", source_type: "blog", found_at: "", score: 5, dir: "", file: "" },
    ]);
    saveCatalog(tmpDir, [
      { id: "2", url: "b", title: "B", source_type: "blog", found_at: "", score: 5, dir: "", file: "" },
    ]);
    const loaded = loadCatalog(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("2");
  });
});

describe("loadTopicState / saveTopicState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return default state when no file exists", () => {
    const state = loadTopicState(tmpDir, "test-slug");
    expect(state.slug).toBe("test-slug");
    expect(state.articles).toEqual({});
    expect(state.directions).toEqual([]);
    expect(state.iteration).toBe(0);
    expect(state.max_iterations).toBe(3);
  });

  it("should save and load state", () => {
    const state = loadTopicState(tmpDir, "test-slug");
    state.topic = "Test Topic";
    state.articles["abc123"] = {
      direction: "pending",
      source_eval: "pending",
      interpretation: "pending",
    };
    saveTopicState(tmpDir, "test-slug", state);

    const loaded = loadTopicState(tmpDir, "test-slug");
    expect(loaded.topic).toBe("Test Topic");
    expect(loaded.articles["abc123"]).toEqual({
      direction: "pending",
      source_eval: "pending",
      interpretation: "pending",
    });
  });

  it("should not merge with catalog (independent management)", () => {
    // 验证 saveTopicState 不触碰 catalog
    const articles: Article[] = [{ id: "1", url: "a", title: "A", source_type: "blog", found_at: "", score: 5, dir: "", file: "" }];
    saveCatalog(tmpDir, articles);

    const state = loadTopicState(tmpDir, "slug");
    state.articles["x"] = { direction: "pending", source_eval: "pending", interpretation: "pending" };
    saveTopicState(tmpDir, "slug", state);

    // catalog 应保持不变
    const catalog = loadCatalog(tmpDir);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].id).toBe("1");
  });
});

describe("scanNewSources", () => {
  let tmpDir: string;
  let topicDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "research-test-"));
    // scanNewSources 使用 getResearchDir(cwd) = cwd/docs/research
    topicDir = path.join(tmpDir, "project");
    fs.mkdirSync(path.join(topicDir, "docs", "research", "sources", "arxiv"), { recursive: true });
    fs.mkdirSync(path.join(topicDir, "docs", "research", "sources", "ssrn"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return empty when no article files exist", () => {
    const articles = scanNewSources(topicDir, []);
    expect(articles).toEqual([]);
  });

  it("should scan and return new articles from source dirs", () => {
    const articleContent = `---
url: https://arxiv.org/abs/1234
title: Test Paper
score: 8
source_type: academic
found_at: "2026-05-09T12:00:00"
---
Paper content here`;

    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "2026-05-09T1200_article.md"), articleContent);

    const articles = scanNewSources(topicDir, []);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("Test Paper");
    expect(articles[0].url).toBe("https://arxiv.org/abs/1234");
    expect(articles[0].source_type).toBe("academic");
    expect(articles[0].score).toBe(8);
    expect(articles[0].dir).toBe("sources/arxiv/");
    expect(articles[0].id.length).toBe(12);
  });

  it("should skip already cataloged articles", () => {
    const url = "https://arxiv.org/abs/1234";
    const existingId = urlToId(url);
    const existingCatalog: Article[] = [
      {
        id: existingId,
        url,
        title: "Test Paper",
        source_type: "academic",
        found_at: "2026-05-09T12:00:00",
        score: 8,
        dir: "sources/arxiv/",
        file: "2026-05-09T1200_article.md",
      },
    ];

    const articleContent = `---
url: ${url}
title: Test Paper
score: 8
source_type: academic
---
Content`;
    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "2026-05-09T1200_article.md"), articleContent);

    const articles = scanNewSources(topicDir, existingCatalog.map((a) => a.id));
    expect(articles).toHaveLength(0);
  });

  it("should handle articles from multiple source dirs", () => {
    const article1 = `---
url: https://arxiv.org/a
title: Paper A
score: 7
source_type: academic
---
A`;
    const article2 = `---
url: https://ssrn.com/b
title: Paper B
score: 9
source_type: academic
---
B`;

    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "2026-05-09T1200_article.md"), article1);
    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "ssrn", "2026-05-09T1201_article.md"), article2);

    const articles = scanNewSources(topicDir, []);
    expect(articles).toHaveLength(2);
    expect(articles.map((a) => a.title).sort()).toEqual(["Paper A", "Paper B"]);
    expect(articles.map((a) => a.dir).sort()).toEqual(["sources/arxiv/", "sources/ssrn/"]);
  });

  it("should skip files without proper frontmatter gracefully", () => {
    // 写一个没有 frontmatter 的文件，应被跳过
    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "bad_article.md"), "No frontmatter here");
    // 写一个正常文件
    const goodArticle = `---
url: https://example.com/good
title: Good Article
score: 6
source_type: blog
---
Content`;
    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "good_article.md"), goodArticle);

    const articles = scanNewSources(topicDir, []);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("Good Article");
  });

  it("should return empty when sources dir does not exist", () => {
    const noSourcesDir = path.join(tmpDir, "empty");
    const articles = scanNewSources(noSourcesDir, []);
    expect(articles).toEqual([]);
  });

  it("should assign default values for missing frontmatter fields", () => {
    const articleContent = `---
url: https://example.com/minimal
---
Some content`;
    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "minimal_article.md"), articleContent);

    const articles = scanNewSources(topicDir, []);
    expect(articles).toHaveLength(1);
    expect(articles[0].url).toBe("https://example.com/minimal");
    expect(articles[0].title).toBe("minimal"); // falls back to filename (without _article.md suffix)
    expect(articles[0].source_type).toBe("other"); // default
    expect(articles[0].score).toBe(5); // default
    expect(articles[0].id.length).toBe(12);
  });

  it("should produce consistent id for same url across scans", () => {
    const articleContent = `---
url: https://example.com/consistent
title: Consistent
score: 7
source_type: blog
---
Content`;
    fs.writeFileSync(path.join(topicDir, "docs", "research", "sources", "arxiv", "2026-05-09T1200_article.md"), articleContent);

    // 用空 catalog 扫描两次，验证 id 一致性
    const articles1 = scanNewSources(topicDir, []);
    expect(articles1[0].id).toBe(urlToId("https://example.com/consistent"));

    // 模拟增量扫描：加入 catalog 后第二次应返回空
    const articles2 = scanNewSources(topicDir, articles1.map((a) => a.id));
    expect(articles2).toHaveLength(0);
  });
});

describe("getTopicDir", () => {
  // getTopicDir 是向后兼容别名，返回 getResearchDir(cwd) = cwd/docs/research
  it("should return getResearchDir(cwd) (backward compat alias)", () => {
    const dir = getTopicDir("/home/user/project", "test-slug");
    expect(dir).toBe("/home/user/project/docs/research");
  });
});
