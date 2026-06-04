import * as fs from "node:fs";
import * as path from "node:path";
import { AGENTS_DIR } from "./paths";

/** 发现 ~/.pi/agent/agents/ 下所有可用的子代理名称 */
export function discoverAgents(): string[] {
	if (!fs.existsSync(AGENTS_DIR)) return [];
	return fs.readdirSync(AGENTS_DIR)
		.filter(f => f.endsWith(".md") && !f.startsWith("_"))
		.map(f => f.replace(/\.md$/, ""));
}

/** 从子代理 .md 文件的 frontmatter 中提取 description 字段 */
export function getAgentDescription(name: string): string {
	const filePath = path.join(AGENTS_DIR, `${name}.md`);
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (match) {
			const descLine = match[1].split("\n").find(l => l.startsWith("description:"));
			if (descLine) return descLine.replace(/^description:\s*/, "").trim();
		}
	} catch { /* ignore */ }
	return "read, grep, find, ls";
}
