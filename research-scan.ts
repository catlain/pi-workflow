/**
 * workflow: 研究管道文件扫描
 *
 * 扫描全局 sources/ 目录，返回未在 catalog 中的新文章。
 * 路径：{cwd}/docs/research/sources/{source_name}/{timestamp}_article.md
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Article } from "./research-types";
import { parseFrontmatter, urlToId, getResearchDir } from "./research-utils";

/**
 * 扫描全局 sources/ 目录，返回不在 existingIds 中的新文章。
 *
 * @param cwd 项目根目录
 * @param existingIds 已有文章 id 列表（去重用）
 */
export function scanNewSources(cwd: string, existingIds: string[]): Article[] {
  const sourcesDir = path.join(getResearchDir(cwd), "sources");
  if (!fs.existsSync(sourcesDir)) return [];

  const existingIdSet = new Set(existingIds);
  const newArticles: Article[] = [];

  const sourceNames = fs.readdirSync(sourcesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const sourceName of sourceNames) {
    const sourcePath = path.join(sourcesDir, sourceName);
    const files = fs.readdirSync(sourcePath)
      .filter((f) => f.endsWith("_article.md"));

    for (const file of files) {
      const filePath = path.join(sourcePath, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const fm = parseFrontmatter(content);
        const url = fm.url || "";

        if (!url) continue;

        const id = urlToId(url);
        if (id && existingIdSet.has(id)) continue;

        newArticles.push({
          id,
          url,
          title: fm.title || file.replace(/\.md$/, "").replace(/_article$/, ""),
          source_type: fm.source_type || "other",
          found_at: fm.found_at || new Date().toISOString(),
          score: typeof fm.score === "number" ? fm.score : 5,
          dir: `sources/${sourceName}/`,
          file,
        });
        if (id) existingIdSet.add(id);
      } catch {
        continue;
      }
    }
  }

  return newArticles;
}
