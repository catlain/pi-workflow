/**
 * WezTerm 分屏后端
 *
 * 分屏策略：
 *   第 1 个子代理 --right（左右分，保留宽度）
 *   第 2+ 个子代理从第 1 个子 pane --bottom（上下分，宽度不变）
 *
 * 通过临时文件记录主 pane → 第 1 个子 pane 的映射关系，
 * 只认自己创建的子 pane，不会误用其他会话的 pane。
 */

import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TermBackend } from "./term-backend";

/** 主 pane → 第 1 个子 pane 的映射文件路径 */
function subPaneMapPath(mainPaneId: string): string {
	return path.join(os.tmpdir(), `pi-subpane-${mainPaneId}.json`);
}

/** 读取第 1 个子 pane ID，如果 pane 还活着就返回 */
function readFirstSubPane(mainPaneId: string): string | null {
	try {
		const mapFile = subPaneMapPath(mainPaneId);
		if (!fs.existsSync(mapFile)) return null;
		const { firstSubPaneId } = JSON.parse(fs.readFileSync(mapFile, "utf-8"));
		// 验证 pane 还活着
		if (!firstSubPaneId || !isWezPaneAlive(String(firstSubPaneId))) {
			fs.unlinkSync(mapFile); // 死了就清掉映射
			return null;
		}
		return String(firstSubPaneId);
	} catch {
		return null;
	}
}

/** 记录第 1 个子 pane ID */
function saveFirstSubPane(mainPaneId: string, subPaneId: string): void {
	try {
		const mapFile = subPaneMapPath(mainPaneId);
		fs.writeFileSync(mapFile, JSON.stringify({ firstSubPaneId: subPaneId }));
	} catch {
		/* ignore */
	}
}

/** 检查 wezterm pane 是否存活 */
function isWezPaneAlive(paneId: string): boolean {
	try {
		const list = execSync("wezterm cli list --format json", {
			encoding: "utf8",
		}).trim();
		const panes = JSON.parse(list) as Array<{ pane_id: number }>;
		return panes.some((p) => String(p.pane_id) === paneId);
	} catch {
		return false;
	}
}

export const weztermBackend: TermBackend = {
	splitPane(cwd: string, command: string): string {
		const currentPane = process.env.WEZTERM_PANE;
		let args: string[];

		// 查找我们之前创建的第 1 个子 pane
		const firstSub = currentPane ? readFirstSubPane(currentPane) : null;

		if (!firstSub) {
			// 第 1 个子代理：从主 pane 左右分
			args = ["cli", "split-pane", "--right", "--cwd", cwd];
			if (currentPane) args.push("--pane-id", currentPane);
		} else {
			// 第 2+ 个子代理：从第 1 个子 pane 上下分
			args = [
				"cli",
				"split-pane",
				"--bottom",
				"--cwd",
				cwd,
				"--pane-id",
				firstSub,
			];
		}
		args.push("--", "bash", command);

		const newPaneId = execFileSync("wezterm", args, {
			encoding: "utf8",
		}).trim();

		// 第 1 个子代理创建后，记录映射
		if (!firstSub && currentPane) {
			saveFirstSubPane(currentPane, newPaneId);
		}

		return newPaneId;
	},
	killPane(paneId: string): void {
		try {
			execSync(`wezterm cli kill-pane --pane-id ${paneId}`, {
				stdio: "pipe",
			});
		} catch {
			/* ignore */
		}
	},
	isPaneAlive(paneId: string): boolean {
		return isWezPaneAlive(paneId);
	},
};
