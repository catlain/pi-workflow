/**
 * Agent 定义文件验证测试
 *
 * 验证 ~/.pi/agent/agents/ 下 _searcher, _directions, _source-eval, _interpretation
 * 四个 agent .md 文件格式符合要求。
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const AGENTS_DIR = path.join(os.homedir(), ".pi", "agent", "agents");

const REQUIRED_AGENTS = [
  "_searcher.md",
  "_directions.md",
  "_source-eval.md",
  "_interpretation.md",
];

interface ParsedAgent {
  name: string;
  tools: string[];
  systemPrompt: string;
  hasInput: boolean;
  hasOutput: boolean;
  hasRules: boolean;
}

function parseAgentFile(filePath: string): ParsedAgent | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);

  let tools: string[] = [];
  let name = path.basename(filePath, ".md");

  if (fmMatch) {
    const fm = fmMatch[1];
    for (const line of fm.split("\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        let val = line.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key === "tools") {
          tools = val.split(",").map((t) => t.trim()).filter(Boolean);
        }
        if (key === "name") {
          name = val;
        }
      }
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  const hasInput = body.includes("## 输入");
  const hasOutput = body.includes("## 输出");
  const hasRules = body.includes("## 规则");

  return { name, tools, systemPrompt: body, hasInput, hasOutput, hasRules };
}

describe("Agent 定义文件格式", () => {
  for (const agentFile of REQUIRED_AGENTS) {
    const filePath = path.join(AGENTS_DIR, agentFile);

    it(`${agentFile} 文件存在`, () => {
      const exists = fs.existsSync(filePath);
      if (!exists) {
        // 列出 agents 目录内容辅助调试
        const files = fs.existsSync(AGENTS_DIR) ? fs.readdirSync(AGENTS_DIR) : [];
        console.log(`agents 目录内容: ${files.join(", ")}`);
      }
      expect(exists, `${filePath} 不存在`).toBe(true);
    });

    if (!fs.existsSync(filePath)) continue;
    it(`${agentFile} 包含 tools frontmatter`, () => {
      const agent = parseAgentFile(filePath);
      expect(agent!.tools.length).toBeGreaterThan(0);
    });

    it(`${agentFile} 包含 "输入" 章节`, () => {
      const agent = parseAgentFile(filePath);
      expect(agent!.hasInput).toBe(true);
    });

    it(`${agentFile} 包含 "输出" 章节`, () => {
      const agent = parseAgentFile(filePath);
      expect(agent!.hasOutput).toBe(true);
    });

    it(`${agentFile} 包含 "规则" 章节`, () => {
      const agent = parseAgentFile(filePath);
      expect(agent!.hasRules).toBe(true);
    });

    it(`${agentFile} 的 frontmatter 与 parseFrontmatter 兼容`, async () => {
      const content = fs.readFileSync(filePath, "utf-8");
      const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      expect(fmMatch).not.toBeNull();

      // 验证 tools 字段可解析
      const fmLines = fmMatch![1].split("\n");
      const toolsLine = fmLines.find((l) => l.trim().startsWith("tools:"));
      expect(toolsLine).toBeDefined();
      expect(toolsLine!).toContain("read");
    });
  }
});
