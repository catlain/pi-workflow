/**
 * workflow: 全局文章分析状态管理
 *
 * analysis.json 跟踪每篇文章的分析进度（评分/解读/方向）。
 * 路径：{cwd}/docs/research/analysis.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getResearchDir } from "./research-utils";

/**
 * 单篇文章的分析状态
 */
export interface ArticleAnalysis {
  /** 是否已提取方向 */
  direction_done: boolean;
  /** 是否已评分 */
  score_evaluated: boolean;
  /** 是否已解读 */
  interpretation_done: boolean;
}

/**
 * 全局分析状态：article_id → ArticleAnalysis
 */
export type AnalysisState = Record<string, ArticleAnalysis>;

function getAnalysisPath(cwd: string): string {
  return path.join(getResearchDir(cwd), "analysis.json");
}

/**
 * 加载全局分析状态。文件不存在时返回空对象。
 */
export function loadAnalysis(cwd: string): AnalysisState {
  const fp = getAnalysisPath(cwd);
  if (!fs.existsSync(fp)) return {};
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

/**
 * 保存全局分析状态。
 */
export function saveAnalysis(cwd: string, state: AnalysisState): void {
  const dir = getResearchDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getAnalysisPath(cwd), JSON.stringify(state, null, 2), "utf-8");
}

/**
 * 为新文章创建默认分析状态（全 pending）。
 */
export function defaultAnalysis(): ArticleAnalysis {
  return {
    direction_done: false,
    score_evaluated: false,
    interpretation_done: false,
  };
}
