/**
 * tmux 分屏后端
 *
 * 分屏策略与 WezTerm 相同：
 *   第 1 个子代理左右分，第 2+ 个从第 1 个子 pane 上下分。
 */

import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TermBackend } from "./term-backend";

/** tmux 版：映射文件路径 */
function tmuxSubPaneMapPath(mainPaneId: string): string {
	return path.join(os.tmpdir(), `pi-tmux-subpane-${mainPaneId}.json`);
}

/** 读取 tmux 第 1 个子 pane ID */
function readFirstTmuxSubPane(mainPaneId: string): string | null {
	try {
		const mapFile = tmuxSubPaneMapPath(mainPaneId);
		if (!fs.existsSync(mapFile)) return null;
		const { firstSubPaneId } = JSON.parse(fs.readFileSync(mapFile, "utf-8"));
		if (!firstSubPaneId) {
			fs.unlinkSync(mapFile);
			return null;
		}
		return String(firstSubPaneId);
	} catch {
		return null;
	}
}

/** 记录 tmux 第 1 个子 pane ID */
function saveFirstTmuxSubPane(mainPaneId: string, subPaneId: string): void {
	try {
		const mapFile = tmuxSubPaneMapPath(mainPaneId);
		fs.writeFileSync(mapFile, JSON.stringify({ firstSubPaneId: subPaneId }));
	} catch {
		/* ignore */
	}
}

export const tmuxBackend: TermBackend = {
	splitPane(_cwd: string, command: string): string {
		const fromPane = process.env.TMUX_PANE;
		let args: string[];

		const firstSub = fromPane ? readFirstTmuxSubPane(fromPane) : null;

		if (!firstSub) {
			// 第 1 个子代理：左右分
			args = ["split-window", "-h", "-d"];
			if (fromPane) args.push("-t", fromPane);
		} else {
			// 第 2+ 个子代理：从第 1 个子 pane 上下分
			args = ["split-window", "-v", "-d", "-t", firstSub];
		}
		args.push("-P", "-F", "#{pane_id}", "bash", command);

		const newPaneId = execFileSync("tmux", args, { encoding: "utf8" }).trim();

		// 第 1 个子代理创建后，记录映射
		if (!firstSub && fromPane) {
			saveFirstTmuxSubPane(fromPane, newPaneId);
		}

		return newPaneId;
	},
	killPane(paneId: string): void {
		try {
			execSync(`tmux kill-pane -t ${paneId}`, { stdio: "pipe" });
		} catch {
			/* ignore */
		}
	},
	isPaneAlive(paneId: string): boolean {
		try {
			execSync(`tmux list-panes -t ${paneId}`, { stdio: "pipe" });
			return true;
		} catch {
			return false;
		}
	},
};
