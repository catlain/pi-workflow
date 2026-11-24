/**
 * 测试 sweepStaleVisibleTaskDirs — 超龄残留兜底清扫
 *
 * 隔离 tmpRoot（mkdtemp 独立目录），不触碰真实 Temp 的 pi-visible-* 残留。
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { sweepStaleVisibleTaskDirs, STALE_VISIBLE_TASK_DIR_MS } from "../proc-guard";

// ESM namespace 不可 spyOn：改用 vi.mock 部分替换 rmSync（其余保留真实）
const holder = vi.hoisted(() => ({ origRm: null as any }));
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal() as any;
	holder.origRm = actual.rmSync;
	return { ...actual, rmSync: vi.fn((t: any, o: any) => holder.origRm(t, o)) };
});
const rmMock = vi.mocked(fs.rmSync);

const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "pg-sweep-"));

/** 把目标及其内部全部条目的 atime/mtime 回拨指定毫秒（锄点=条目最大 mtime，目录需回拨内部条目；文件只回拨自身） */
const backdateTree = (target: string, ms: number) => {
	const past = new Date(Date.now() - ms);
	fs.utimesSync(target, past, past);
	if (!fs.lstatSync(target).isDirectory()) return;
	for (const entry of fs.readdirSync(target)) {
		fs.utimesSync(path.join(target, entry), past, past);
	}
};

describe("sweepStaleVisibleTaskDirs", () => {
	it("超龄目录被删除，新鲜目录保留", () => {
		const root = mkRoot();
		try {
			const stale = path.join(root, "pi-visible-old");
			const fresh = path.join(root, "pi-visible-fresh");
			fs.mkdirSync(stale); fs.mkdirSync(fresh);
			fs.writeFileSync(path.join(stale, "task.txt"), "x");
			fs.writeFileSync(path.join(fresh, "task.txt"), "y");
			backdateTree(stale, STALE_VISIBLE_TASK_DIR_MS + 3600_000);

			sweepStaleVisibleTaskDirs(root);
			expect(fs.existsSync(stale)).toBe(false);
			expect(fs.existsSync(fresh)).toBe(true);
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("锚点取目录内条目最大 mtime：文件新鲜则目录不删（目录 mtime 已超龄）", () => {
		const root = mkRoot();
		try {
			const dir = path.join(root, "pi-visible-longrun");
			fs.mkdirSync(dir);
			fs.writeFileSync(path.join(dir, "task.txt"), "x");
			backdateTree(dir, STALE_VISIBLE_TASK_DIR_MS + 3600_000); // 目录自身超龄
			// 但 session.jsonl 五分钟前刚刷新（长任务运行中）
			fs.writeFileSync(path.join(dir, "session.jsonl"), "line\n");
			backdateTree(path.join(dir, "session.jsonl"), 5 * 60_000);

			sweepStaleVisibleTaskDirs(root);
			expect(fs.existsSync(dir)).toBe(true); // 锚点=最新文件 mtime，未超龄
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	// 存活的目录跳过（死透检查）——修复反例：C2 sweep 违反自身不变量
	it("proc.pid 指向活进程的超龄目录跳过不删", () => {
		const root = mkRoot();
		try {
			const alive = path.join(root, "pi-visible-alive");
			fs.mkdirSync(alive);
			fs.writeFileSync(path.join(alive, "task.txt"), "x");
			backdateTree(alive, STALE_VISIBLE_TASK_DIR_MS * 2);
			// 假装该目录属于当前 vitest 进程（两平台语义位同填，必然存活）
			fs.writeFileSync(path.join(alive, "proc.pid"), `${process.pid} ${process.pid}\n`);
			sweepStaleVisibleTaskDirs(root);
			expect(fs.existsSync(alive)).toBe(true);
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("非 pi-visible-* 前缀目录不触碰", () => {
		const root = mkRoot();
		try {
			const other = path.join(root, "pi-pv-other");
			fs.mkdirSync(other);
			backdateTree(other, STALE_VISIBLE_TASK_DIR_MS * 2);
			sweepStaleVisibleTaskDirs(root);
			expect(fs.existsSync(other)).toBe(true);
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("单个目录删除失败不中断扫描（容错）", () => {
		const root = mkRoot();
		try {
			const poisoned = path.join(root, "pi-visible-poison");
			const stale = path.join(root, "pi-visible-ok");
			fs.mkdirSync(poisoned); fs.mkdirSync(stale);
			backdateTree(poisoned, STALE_VISIBLE_TASK_DIR_MS * 2);
			backdateTree(stale, STALE_VISIBLE_TASK_DIR_MS * 2);
			rmMock.mockImplementation(((target: any, opts: any) => {
				if (String(target) === poisoned) throw new Error("EPERM");
				return holder.origRm(target, opts);
			}) as any);
			try {
				sweepStaleVisibleTaskDirs(root);
				expect(fs.existsSync(stale)).toBe(false); // 后续目录继续处理
			} finally {
				rmMock.mockImplementation(((t: any, o: any) => holder.origRm(t, o)) as any);
			}
		} finally { fs.rmSync(root, { recursive: true, force: true }); }
	});

	it("扫描根不可读不抛错（顶层容错）", () => {
		expect(() => sweepStaleVisibleTaskDirs(path.join(os.tmpdir(), "definitely-missing-root"))).not.toThrow();
	});
});
