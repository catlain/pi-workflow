/**
 * utils.ts 测试 — getSubagentStatusSummary
 *
 * 依赖 node:os / node:fs，需要 mock。
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockHomedir = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReaddirSync = vi.hoisted(() => vi.fn());
const mockStatSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:os", () => ({ homedir: mockHomedir }));
vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
	readdirSync: mockReaddirSync,
	statSync: mockStatSync,
	readFileSync: mockReadFileSync,
}));

import { getSubagentStatusSummary } from "../utils";

function setupBasicMock() {
	mockHomedir.mockReturnValue("/home/test");
	mockExistsSync.mockReturnValue(true);
	mockReaddirSync.mockReturnValueOnce(["project1"]);
	mockStatSync.mockReturnValue({ isDirectory: () => true });
	mockReaddirSync.mockReturnValueOnce(["session-123.jsonl"]);
}

describe("getSubagentStatusSummary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should_return_undefined_when_session_file_not_found", () => {
		mockHomedir.mockReturnValue("/home/test");
		mockExistsSync.mockReturnValue(false);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toBeUndefined();
	});

	it("should_return_formatted_summary_for_valid_session", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				type: "message",
				message: { role: "assistant" },
				timestamp: "2024-01-01T12:00:00Z",
			}) + "\n",
		);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toBe("1条消息 (12:00:00) [0KB]");
	});

	it("should_include_tool_name_in_summary", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "toolCall", name: "read_file" }],
				},
				timestamp: "2024-01-01T12:00:00Z",
			}) + "\n",
		);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toContain("最近动作: read_file");
	});

	it("should_count_only_assistant_role_messages", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue(
			[
				JSON.stringify({ type: "message", message: { role: "user" } }),
				JSON.stringify({ type: "message", message: { role: "assistant" } }),
				JSON.stringify({ type: "message", message: { role: "assistant" } }),
			].join("\n") + "\n",
		);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toContain("2条消息");
	});

	it("should_use_last_tool_and_timestamp_from_multiple_messages", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue(
			[
				JSON.stringify({
					type: "message",
					message: { role: "assistant", content: [{ type: "toolCall", name: "first_tool" }] },
					timestamp: "2024-01-01T12:01:00Z",
				}),
				JSON.stringify({
					type: "message",
					message: { role: "assistant", content: [{ type: "toolCall", name: "second_tool" }] },
					timestamp: "2024-01-01T12:02:00Z",
				}),
			].join("\n") + "\n",
		);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toContain("2条消息");
		expect(result).toContain("最近动作: second_tool");
		expect(result).toContain("(12:02:00)");
	});

	it("should_skip_malformed_json_lines_gracefully", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue(
			[
				"{invalid json}",
				JSON.stringify({ type: "message", message: { role: "assistant" } }),
				"",
			].join("\n") + "\n",
		);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toContain("1条消息");
	});

	it("should_return_undefined_when_file_read_throws", () => {
		setupBasicMock();
		mockReadFileSync.mockImplementation(() => {
			throw new Error("read error");
		});

		const result = getSubagentStatusSummary("session-123");
		expect(result).toBeUndefined();
	});

	it("should_show_zero_messages_when_no_assistant_found", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue(
			JSON.stringify({
				type: "message",
				message: { role: "user", content: [{ type: "text", text: "hi" }] },
			}) + "\n",
		);

		const result = getSubagentStatusSummary("session-123");
		expect(result).toBe("0条消息  [0KB]");
	});

	it("should_show_kb_size_in_summary", () => {
		setupBasicMock();
		mockReadFileSync.mockReturnValue("x".repeat(2048) + "\n");

		const result = getSubagentStatusSummary("session-123");
		expect(result).toContain("[2KB]");
	});
});
