/**
 * workflow: 子代理输出保存
 *
 * 将子代理的完整输出写入文件，只返回简短总结。
 * 所有子代理工具统一使用此函数，避免各自重复实现截断逻辑。
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface SubagentOutput {
	/** 输出文件路径 */
	filePath: string;
	/** 简短总结（≤ 200 字符） */
	summary: string;
	/** 总行数 */
	lineCount: number;
	/** 文件大小（字节） */
	size: number;
}

/**
 * 将子代理的完整输出写入文件，只返回简短总结。
 *
 * 输出文件保存在: {cwd}/.pi/plans/subagent-output-{工具名}-{时间戳}.md
 *
 * @param cwd       当前工作目录
 * @param toolName  工具名称（用于文件名标识，如 "review"）
 * @param output    子代理的完整输出文本
 * @param extra     可选的额外摘要信息（如测试统计）
 */
export function saveSubagentOutput(
	cwd: string,
	toolName: string,
	output: string,
	extra?: { passed?: number; failed?: number; total?: number; warnings?: number; criticals?: number },
): SubagentOutput {
	const plansDir = path.join(cwd, ".pi", "plans");
	if (!fs.existsSync(plansDir)) fs.mkdirSync(plansDir, { recursive: true });

	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
	const filePath = path.join(plansDir, `${toolName}-${timestamp}.md`);

	fs.writeFileSync(filePath, output, "utf-8");

	const lines = output.split("\n");
	const lineCount = lines.length;
	const size = Buffer.byteLength(output, "utf-8");

	const parts: string[] = [];

	if (extra?.passed !== undefined) {
		parts.push(`✅ ${extra.passed} passed`);
	}
	if (extra?.failed) {
		parts.push(`❌ ${extra.failed} failed`);
	}
	if (extra?.criticals) {
		parts.push(`🔴 ${extra.criticals} critical`);
	}
	if (extra?.warnings) {
		parts.push(`🟡 ${extra.warnings} warnings`);
	}

	const sizeStr = size > 1024 * 1024
		? `${(size / 1024 / 1024).toFixed(1)}MB`
		: size > 1024
			? `${(size / 1024).toFixed(0)}KB`
			: `${size}B`;

	const stats = parts.length > 0 ? ` | ${parts.join(", ")}` : "";
	const summary = `完整输出已保存 (${lineCount} 行, ${sizeStr}${stats})`;

	return { filePath, summary, lineCount, size };
}

/**
 * 读取之前保存的子代理输出文件内容。
 */
export function readSubagentOutput(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}
