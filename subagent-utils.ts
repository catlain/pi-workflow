/**
 * workflow: 子代理工具函数
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * 将 Windows 反斜杠路径转为 Unix 正斜杠路径。
 * launch.sh 在 bash 里执行，反斜杠会被解释为转义字符导致路径错误。
 */
function toUnixPath(p: string): string {
	return p.replace(/\\/g, "/");
}

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

	// 从 cwd 推导 session 子目录
	const cwdSlug = "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
	const sessionDir = path.join(baseDir, cwdSlug);
	if (!fs.existsSync(sessionDir)) return;

	try {
		// 按修改时间降序，优先检查最近的文件
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

/** 可见模式的临时目录信息 */
export interface VisibleTaskDir {
	taskDir: string;
	taskFile: string;
	sessionFile: string;
	launchScript: string;
}

/**
 * 创建可见模式的临时目录和启动脚本。
 * 调用方负责在结束时删除 taskDir。
 */
export function createVisibleTaskDir(
	task: string,
	cwd: string,
	systemPromptPath: string,
	agentDef: { tools: string[]; model?: string },
	modelOverride?: string,
	extraEnv?: Record<string, string>,
): VisibleTaskDir {
	const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-visible-"));
	const taskFile = path.join(taskDir, "task.txt");
	fs.writeFileSync(taskFile, task, { encoding: "utf-8" });

	const sessionFile = path.join(taskDir, "session.jsonl");

	const modelArg = (modelOverride || agentDef.model)
		? ` --model ${modelOverride || agentDef.model}`
		: "";

	// extraEnv 生成 shell export 行（安全转义单引号）
	const extraEnvExports = extraEnv
		? Object.entries(extraEnv)
			.map(([k, v]) => `export ${k}='${v.split("'").join("'\\''")}'`)
			.join("\n")
		: "";

	const launchScript = path.join(taskDir, "launch.sh");

	// launch.sh 在 bash 里执行，所有路径必须用 Unix 格式（正斜杠）
	const uCwd = toUnixPath(cwd);
	const uSessionFile = toUnixPath(sessionFile);
	const uSystemPromptPath = toUnixPath(systemPromptPath);
	const uTaskFile = toUnixPath(taskFile);

	const script = [
		"#!/bin/bash",
		'export FNM_PATH="$HOME/.local/share/fnm"',
		'if [ -d "$FNM_PATH" ]; then export PATH="$FNM_PATH:$PATH" && eval "$(fnm env --shell bash)"; fi',
		`cd "${uCwd}"`,
		"export PI_SUBAGENT_AUTO_EXIT=1",
		`export PI_SUBAGENT_SESSION='${uSessionFile}'`,
		`export PI_SUBAGENT_NAME='pv-visible'`,
		extraEnvExports,
		`pi --session '${uSessionFile}' --tools ${agentDef.tools.join(",")} --append-system-prompt '${uSystemPromptPath}'${modelArg} @'${uTaskFile}'`,
	].filter(Boolean).join("\n");
	fs.writeFileSync(launchScript, script, { mode: 0o700 });

	return { taskDir, taskFile, sessionFile, launchScript };
}
