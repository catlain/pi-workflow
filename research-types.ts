/**
 * workflow: 研究管道类型定义
 */

/** 文章条目 */
export interface Article {
  /** sha256(url)[:12] */
  id: string;
  url: string;
  title: string;
  source_type: "academic" | "report" | "blog" | "other";
  /** ISO datetime */
  found_at: string;
  /** 1-10 */
  score: number;
  /** sources/{source_name}/ */
  dir: string;
  /** {timestamp}_article.md */
  file: string;
}

/** 文章在各子代理中的分析状态 */
export interface ArticleAnalysis {
  direction: "pending" | "done" | "skipped";
  source_eval: "pending" | "done" | "skipped";
  interpretation: "pending" | "done" | "skipped";
}

/** 研究方向 */
export interface Direction {
  id: string;
  title: string;
  description: string;
  source_dirs: string[];
  actionability: "high" | "medium" | "low";
  status: "proposed" | "verifying" | "verified" | "rejected";
  reject_reason?: string;
  /** directions/{timestamp}_directions.md */
  file?: string;
}

/** 主题研究状态 */
export interface TopicResearchState {
  topic: string;
  slug: string;
  created_at: string;
  queries_searched: Array<{ query: string; searched_at: string }>;
  /** key = article.id */
  articles: Record<string, ArticleAnalysis>;
  directions: Direction[];
  iteration: number;
  max_iterations: number;
}
