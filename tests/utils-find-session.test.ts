/**
 * utils.ts 测试 — findSessionFile
 *
 * 依赖 node:os / node:fs，需要 mock。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as path from "node:path";

const mockHomedir = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockStatSync = vi.hoisted(() => vi.fn());

vi.mock("node:os", () => ({ homedir: mockHomedir }));
vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
	readdirSync: mockReaddirSync,
	statSync: mockStatSync,
}));

import { findSessionFile } from "../utils";

describe("findSessionFile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should_return_undefined_when_session_dir_does_not_exist", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(false);

		const result = findSessionFile("session-123");
		expect(result).toBeUndefined();
	});

	it("should_return_undefined_when_session_dir_is_empty", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockReturnValue([]);

		const result = findSessionFile("session-123");
		expect(result).toBeUndefined();
	});

	it("should_skip_non_directory_entries_in_session_dir", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockReturnValue(["file.txt"]);
		mockStatSync.mockReturnValue({ isDirectory: () => false });

		const result = findSessionFile("session-123");
		expect(result).toBeUndefined();
	});

	it("should_return_path_when_matching_file_found", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockReturnValueOnce(["project1"]);
		mockStatSync.mockReturnValue({ isDirectory: () => true });
		mockReaddirSync.mockReturnValueOnce(["session-123.jsonl"]);

		const result = findSessionFile("session-123");
		expect(result).toBe(
			path.join("/home/test", ".pi", "agent", "sessions", "project1", "session-123.jsonl"),
		);
	});

	it("should_return_undefined_when_no_file_in_project_dirs_matches", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockReturnValueOnce(["project1"]);
		mockStatSync.mockReturnValue({ isDirectory: () => true });
		mockReaddirSync.mockReturnValueOnce(["other-session.jsonl"]);

		const result = findSessionFile("session-123");
		expect(result).toBeUndefined();
	});

	it("should_search_across_multiple_project_dirs", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockReturnValueOnce(["proj-a", "proj-b"]);
		mockStatSync.mockReturnValue({ isDirectory: () => true });
		mockReaddirSync
			.mockReturnValueOnce(["other.jsonl"])
			.mockReturnValueOnce(["session-456.jsonl"]);

		const result = findSessionFile("session-456");
		expect(result).toBe(
			path.join("/home/test", ".pi", "agent", "sessions", "proj-b", "session-456.jsonl"),
		);
	});

	it("should_match_partial_session_id_in_filename", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(true);
		mockReaddirSync.mockReturnValueOnce(["project1"]);
		mockStatSync.mockReturnValue({ isDirectory: () => true });
		mockReaddirSync.mockReturnValueOnce(["abc-session-123-xyz.jsonl"]);

		const result = findSessionFile("session-123");
		expect(result).toBe(
			path.join(
				"/home/test",
				".pi",
				"agent",
				"sessions",
				"project1",
				"abc-session-123-xyz.jsonl",
			),
		);
	});
});
