/**
 * workflow: 子代理工具函数
 *
 * 从 PV 的 subagent.ts 提取的通用函数。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * 将 parentSession 注入子代理 session JSONL 首行的 header。
 * 用于建立主会话→子代理会话的关联链。
 */
export function injectParentSession(sessionFilePath: string, parentPath: string): void {
	try {
		const content = fs.readFileSync(sessionFilePath, "utf-8");
		const firstNewline = content.indexOf("\n");
		const firstLine = firstNewline >= 0 ? content.slice(0, firstNewline) : content;
		const rest = firstNewline >= 0 ? content.slice(firstNewline) : "";
		try {
			const header = JSON.parse(firstLine);
			if (header.type === "session" && !header.parentSession) {
				header.parentSession = parentPath;
				fs.writeFileSync(sessionFilePath, JSON.stringify(header) + rest, "utf-8");
			}
		} catch { /* 首行不是有效 JSON，跳过 */ }
	} catch { /* 文件不存在或无法读取，跳过 */ }
}

/**
 * 通过 sessionId 查找子代理 session 文件并注入 parentSession。
 * 用于 spawnOnce 模式（session 文件路径未知，需要按 ID 搜索）。
 */
export function findAndInjectParentSession(sessionId: string | undefined, parentPath: string, cwd: string): void {
	if (!sessionId || !parentPath) return;
	const baseDir = process.env.PI_CODING_AGENT_SESSION_DIR
		|| path.join(os.homedir(), ".pi/agent/sessions");
	if (!fs.existsSync(baseDir)) return;

	const cwdSlug = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
	const sessionDir = path.join(baseDir, cwdSlug);
	if (!fs.existsSync(sessionDir)) return;

	try {
		const files = fs.readdirSync(sessionDir)
			.filter(f => f.endsWith(".jsonl"))
			.map(f => ({ name: f, mtime: fs.statSync(path.join(sessionDir, f)).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, 20);

		for (const { name } of files) {
			const filePath = path.join(sessionDir, name);
			try {
				const fd = fs.openSync(filePath, "r");
				const buf = Buffer.alloc(500);
				fs.readSync(fd, buf, 0, 500, 0);
				fs.closeSync(fd);
				const firstLine = buf.toString("utf-8").split("\n")[0];
				const header = JSON.parse(firstLine);
				if (header.id === sessionId) {
					injectParentSession(filePath, parentPath);
					return;
				}
			} catch { /* skip */ }
		}
	} catch { /* skip */ }
}

/**
 * 获取启动 pi 的 command + args。
 * 优先用当前进程的可执行文件路径，回退到 PATH 中的 "pi"。
 */
export function getPiCommand(): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	if (/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: "pi", args: [] };
	}
	return { command: process.execPath, args: [] };
}

/**
 * 将 system prompt 写入临时文件，返回文件路径。
 * 调用方负责删除临时文件和目录。
 */
export async function writeTempPrompt(content: string): Promise<string> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-pv-"));
	const filePath = path.join(tmpDir, "system-prompt.md");
	await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
	return filePath;
}
