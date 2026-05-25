/**
 * workflow: Agent 定义加载器
 *
 * 从 ~/.pi/agent/agents/*.md 或 ~/.agents/agents/*.md 加载子代理定义。
 * 带 mtime 缓存，避免重复解析。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AgentDef {
	name: string;
	tools: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
}

interface CacheEntry {
	mtime: number;
	def: AgentDef;
}

const agentCache = new Map<string, CacheEntry>();

export function loadAgentDef(agentName: string): AgentDef | null {
	const dirs = [
		path.join(os.homedir(), ".pi", "agent", "agents"),
		path.join(os.homedir(), ".agents", "agents"),
	];

	for (const searchDir of dirs) {
		const filePath = path.join(searchDir, `${agentName}.md`);
		if (!fs.existsSync(filePath)) continue;

		const stat = fs.statSync(filePath);
		const cacheKey = filePath;

		const cached = agentCache.get(cacheKey);
		if (cached && cached.mtime === stat.mtimeMs) {
			return cached.def;
		}

		const content = fs.readFileSync(filePath, "utf-8");
		const def = parseAgentFile(content, agentName);
		if (def) {
			agentCache.set(cacheKey, { mtime: stat.mtimeMs, def });
			return def;
		}
	}

	return null;
}

function parseAgentFile(content: string, agentName: string): AgentDef {
	const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
	if (!fmMatch) {
		return {
			name: agentName,
			tools: ["read", "grep", "find", "ls"],
			systemPrompt: content.trim(),
		};
	}

	const fm = fmMatch[1];
	const body = content.slice(fmMatch[0].length).trim();
	const fields: Record<string, string> = {};

	for (const line of fm.split("\n")) {
		const idx = line.indexOf(":");
		if (idx > 0) {
			let val = line.slice(idx + 1).trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			fields[line.slice(0, idx).trim()] = val;
		}
	}

	return {
		name: fields.name || agentName,
		tools: fields.tools ? fields.tools.split(",").map((t) => t.trim()).filter(Boolean) : ["read", "grep", "find", "ls"],
		model: fields.model || undefined,
		thinking: fields.thinking || undefined,
		systemPrompt: body || content.trim(),
	};
}
