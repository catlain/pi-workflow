/**
 * workflow: 主题方向状态管理
 *
 * 每个主题的方向状态独立管理。
 * 路径：{cwd}/docs/research/directions/{slug}/state.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TopicResearchState } from "./research-types";
import { getDirectionsDir } from "./research-utils";

function getStatePath(cwd: string, slug: string): string {
  return path.join(getDirectionsDir(cwd, slug), "state.json");
}

/** 加载主题方向状态 */
export function loadTopicState(cwd: string, slug: string): TopicResearchState {
  const p = getStatePath(cwd, slug);
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      topic: "",
      slug,
      created_at: new Date().toISOString(),
      queries_searched: [],
      articles: {},
      directions: [],
      iteration: 0,
      max_iterations: 3,
    };
  }
}

/** 保存主题方向状态 */
export function saveTopicState(cwd: string, slug: string, state: TopicResearchState): void {
  const dir = getDirectionsDir(cwd, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getStatePath(cwd, slug), JSON.stringify(state, null, 2), "utf-8");
}

/** 别名（与旧代码兼容） */
export const loadDirectionState = loadTopicState;
export const saveDirectionState = saveTopicState;
