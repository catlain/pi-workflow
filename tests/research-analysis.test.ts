/**
 * research-analysis.ts 测试
 *
 * 覆盖：loadAnalysis / saveAnalysis / defaultAnalysis 的全路径
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFs = vi.hoisted(() => ({
	existsSync: vi.fn<(path: string) => boolean>(),
	readFileSync: vi.fn<(path: string, encoding: string) => string>(),
	writeFileSync: vi.fn<(path: string, data: string, encoding: string) => void>(),
	mkdirSync: vi.fn<(path: string, options: object) => void>(),
}));

vi.mock("node:fs", () => mockFs);

import { loadAnalysis, saveAnalysis, defaultAnalysis } from "../research-analysis";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("defaultAnalysis", () => {
	it("should return ArticleAnalysis with all false", () => {
		const result = defaultAnalysis();
		expect(result).toEqual({
			direction_done: false,
			score_evaluated: false,
			interpretation_done: false,
		});
	});
});

describe("loadAnalysis", () => {
	it("should return empty object when file does not exist", () => {
		mockFs.existsSync.mockReturnValue(false);
		const result = loadAnalysis("/test/project");
		expect(result).toEqual({});
		expect(mockFs.existsSync).toHaveBeenCalledWith(
			expect.stringContaining("analysis.json"),
		);
	});

	it("should parse and return valid JSON from file", () => {
		const saved = {
			"abc123": {
				direction_done: true,
				score_evaluated: false,
				interpretation_done: true,
			},
			"def456": {
				direction_done: false,
				score_evaluated: true,
				interpretation_done: false,
			},
		};
		mockFs.existsSync.mockReturnValue(true);
		mockFs.readFileSync.mockReturnValue(JSON.stringify(saved));
		const result = loadAnalysis("/test/project");
		expect(result).toEqual(saved);
	});

	it("should return empty object on JSON parse error", () => {
		mockFs.existsSync.mockReturnValue(true);
		mockFs.readFileSync.mockReturnValue("{invalid json}");
		const result = loadAnalysis("/test/project");
		expect(result).toEqual({});
	});

	it("should return empty object when readFileSync throws", () => {
		mockFs.existsSync.mockReturnValue(true);
		mockFs.readFileSync.mockImplementation(() => {
			throw new Error("read error");
		});
		const result = loadAnalysis("/test/project");
		expect(result).toEqual({});
	});
});

describe("saveAnalysis", () => {
	it("should create directory if missing then write file", () => {
		mockFs.existsSync.mockReturnValue(false);

		const state = { "art001": defaultAnalysis() };
		saveAnalysis("/test/project", state);

		expect(mockFs.existsSync).toHaveBeenCalledWith(
			expect.stringMatching(/[\\/]docs[\\/]research/),
		);
		expect(mockFs.mkdirSync).toHaveBeenCalledWith(
			expect.stringMatching(/[\\/]docs[\\/]research/),
			{ recursive: true },
		);
		expect(mockFs.writeFileSync).toHaveBeenCalledWith(
			expect.stringContaining("analysis.json"),
			expect.stringContaining("art001"),
			"utf-8",
		);
	});

	it("should write file when directory already exists", () => {
		mockFs.existsSync.mockReturnValue(true);

		const state = { "art002": defaultAnalysis() };
		saveAnalysis("/test/project", state);

		expect(mockFs.mkdirSync).not.toHaveBeenCalled();
		expect(mockFs.writeFileSync).toHaveBeenCalledWith(
			expect.stringContaining("analysis.json"),
			expect.any(String),
			"utf-8",
		);
	});

	it("should write prettified JSON with 2-space indent", () => {
		mockFs.existsSync.mockReturnValue(true);

		const state = { "key1": defaultAnalysis() };
		saveAnalysis("/test/project", state);

		const callArgs = mockFs.writeFileSync.mock.calls[0];
		const writtenJson = callArgs[1] as string;
		const parsed = JSON.parse(writtenJson);
		expect(parsed).toEqual(state);
		// 验证漂亮打印：键前应有空格
		expect(writtenJson).toContain("\n  ");
	});
});

describe("loadAnalysis -> saveAnalysis round-trip", () => {
	it("should round-trip state through JSON", () => {
		// loadAnalysis: file exists
		mockFs.existsSync.mockReturnValue(true);
		const state1 = {
			"art001": { direction_done: true, score_evaluated: false, interpretation_done: false },
			"art002": { direction_done: true, score_evaluated: true, interpretation_done: true },
		};
		mockFs.readFileSync.mockReturnValue(JSON.stringify(state1));

		const loaded = loadAnalysis("/test/project");
		expect(loaded).toEqual(state1);

		// saveAnalysis: write back
		loaded.art003 = defaultAnalysis();
		saveAnalysis("/test/project", loaded);

		const savedArg = mockFs.writeFileSync.mock.calls[0][1] as string;
		const parsed = JSON.parse(savedArg);
		expect(parsed).toHaveProperty("art001");
		expect(parsed).toHaveProperty("art002");
		expect(parsed).toHaveProperty("art003");
		expect(parsed.art003).toEqual(defaultAnalysis());
	});
});
