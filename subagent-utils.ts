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
