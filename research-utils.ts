/**
 * workflow: 研究管道工具函数
 *
 * 通用工具：slugify、urlToId、parseFrontmatter、getTimestamp
 * 路径函数：getResearchDir、getDirectionsDir
 */

import * as path from "node:path";
import { createHash } from "node:crypto";

/**
 * 获取全局研究目录。
 * 路径：{cwd}/docs/research/
 */
export function getResearchDir(cwd: string): string {
	return path.join(cwd, "docs", "research");
}

/**
 * 获取按主题分的方向目录。
 * 路径：{cwd}/docs/research/directions/{slug}/
 */
export function getDirectionsDir(cwd: string, slug: string): string {
	return path.join(getResearchDir(cwd), "directions", slug);
}

/**
 * 旧函数保留别名（向后兼容）
 * @deprecated 使用 getResearchDir + getDirectionsDir
 */
export function getTopicDir(cwd: string, _slug: string): string {
	return getResearchDir(cwd);
}

/**
 * 解析 YAML-like frontmatter。
 */
export function parseFrontmatter(content: string): Record<string, any> {
	const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
	if (!fmMatch) return {};

	const fm = fmMatch[1];
	const result: Record<string, any> = {};

	for (const line of fm.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx <= 0) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		let value: string = trimmed.slice(colonIdx + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		if (/^\d+$/.test(value)) {
			value = parseInt(value, 10);
		} else if (/^\d+\.\d+$/.test(value)) {
			value = parseFloat(value);
		} else if (value === "true") {
			value = true;
		} else if (value === "false") {
			value = false;
		}

		result[key] = value;
	}

	return result;
}

/**
 * 从 URL 生成唯一 ID：sha256(url)[:12]
 */
export function urlToId(url: string): string {
	return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

/**
 * 从主题文本生成 slug。
 *
 * 规则：去标点、空格转横线、保留中英文+数字、截断至 maxLength。
 * 超长时追加 8 位 hash 防碰撞。
 */
export function slugify(topic: string, maxLength = 40): string {
	const raw = topic
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	// 短 topic 直接返回
	if (raw.length <= maxLength) return raw;

	// 超 long：截断 + hash 后缀防碰撞
	const hash = createHash("sha256").update(raw).digest("hex").slice(0, 8);
	const truncated = raw.slice(0, maxLength - 9); // 留 1 横线 + 8 hash
	return `${truncated}-${hash}`;
}

/**
 * 获取格式化时间戳："2026-05-09T2000"
 */
export function getTimestamp(): string {
	const now = new Date();
	const yyyy = now.getFullYear();
	const MM = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	return `${yyyy}-${MM}-${dd}T${hh}${mm}`;
}
