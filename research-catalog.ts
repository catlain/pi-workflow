/**
 * workflow: 研究管道 Catalog 管理
 *
 * catalog 是全局文章目录。
 * 路径：{cwd}/docs/research/catalog.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Article } from "./research-types";
import { getResearchDir } from "./research-utils";

function getCatalogPath(cwd: string): string {
  return path.join(getResearchDir(cwd), "catalog.json");
}

/** 加载全局文章目录 */
export function loadCatalog(cwd: string): Article[] {
  const p = getCatalogPath(cwd);
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** 保存全局文章目录 */
export function saveCatalog(cwd: string, catalog: Article[]): void {
  const dir = getResearchDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCatalogPath(cwd), JSON.stringify(catalog, null, 2), "utf-8");
}
