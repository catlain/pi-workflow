/**
 * workflow: 研究管道基础设施（barrel export）
 *
 * 子模块：
 *   research-types.ts    — 类型定义
 *   research-utils.ts    — 通用工具（slugify, urlToId, getResearchDir 等）
 *   research-catalog.ts  — catalog 管理
 *   research-state.ts    — 主题方向状态管理
 *   research-analysis.ts — 全局文章分析状态
 *   research-scan.ts     — 文件扫描
 */

export type {
  Article,
  ArticleAnalysis as ArticleAnalysisType,
  Direction,
  TopicResearchState,
} from "./research-types";

export {
  slugify,
  urlToId,
  parseFrontmatter,
  getTimestamp,
  getResearchDir,
  getDirectionsDir,
  getTopicDir,
} from "./research-utils";

export {
  loadCatalog,
  saveCatalog,
} from "./research-catalog";

export {
  loadTopicState,
  saveTopicState,
  loadDirectionState,
  saveDirectionState,
} from "./research-state";

export {
  loadAnalysis,
  saveAnalysis,
  defaultAnalysis,
  type ArticleAnalysis,
  type AnalysisState,
} from "./research-analysis";

export {
  scanNewSources,
} from "./research-scan";
