/**
 * output.ts 测试 — saveSubagentOutput / readSubagentOutput
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { saveSubagentOutput, readSubagentOutput } from "../output";

describe("saveSubagentOutput", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-output-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should_create_file_in_plans_dir", () => {
		const result = saveSubagentOutput(tmpDir, "review", "hello world");
		const plansDir = path.join(tmpDir, ".pi", "plans");

		expect(fs.existsSync(result.filePath)).toBe(true);
		expect(result.filePath).toContain("review-");
		expect(result.filePath).toMatch(/\.md$/);
		expect(fs.readdirSync(plansDir).length).toBe(1);
	});

	it("should_write_full_output_to_file", () => {
		const output = "line1\nline2\nline3";
		const result = saveSubagentOutput(tmpDir, "test", output);

		expect(fs.readFileSync(result.filePath, "utf-8")).toBe(output);
	});

	it("should_return_correct_line_count", () => {
		const result = saveSubagentOutput(tmpDir, "test", "a\nb\nc\nd");
		expect(result.lineCount).toBe(4);
	});

	it("should_return_correct_byte_size", () => {
		const output = "hello"; // 5 bytes
		const result = saveSubagentOutput(tmpDir, "test", output);
		expect(result.size).toBe(5);
	});

	it("should_include_size_in_summary_as_bytes", () => {
		const result = saveSubagentOutput(tmpDir, "test", "hello");
		expect(result.summary).toContain("5B");
	});

	it("should_include_size_in_summary_as_kb", () => {
		const big = "x".repeat(2048);
		const result = saveSubagentOutput(tmpDir, "test", big);
		expect(result.summary).toContain("2KB");
	});

	it("should_include_size_in_summary_as_mb", () => {
		const big = "x".repeat(2 * 1024 * 1024);
		const result = saveSubagentOutput(tmpDir, "test", big);
		expect(result.summary).toContain("2.0MB");
	});

	it("should_include_passed_count_in_summary", () => {
		const result = saveSubagentOutput(tmpDir, "test", "ok", { passed: 10 });
		expect(result.summary).toContain("✅ 10 passed");
	});

	it("should_include_failed_and_critical_in_summary", () => {
		const result = saveSubagentOutput(tmpDir, "test", "ok", { failed: 2, criticals: 1 });
		expect(result.summary).toContain("❌ 2 failed");
		expect(result.summary).toContain("🔴 1 critical");
	});

	it("should_include_warnings_in_summary", () => {
		const result = saveSubagentOutput(tmpDir, "test", "ok", { warnings: 5 });
		expect(result.summary).toContain("🟡 5 warnings");
	});

	it("should_include_zero_passed_in_summary", () => {
		const result = saveSubagentOutput(tmpDir, "test", "ok", { passed: 0 });
		expect(result.summary).toContain("✅ 0 passed");
	});

	it("should_create_plans_dir_if_missing", () => {
		expect(fs.existsSync(path.join(tmpDir, ".pi", "plans"))).toBe(false);
		saveSubagentOutput(tmpDir, "test", "content");
		expect(fs.existsSync(path.join(tmpDir, ".pi", "plans"))).toBe(true);
	});
});

describe("readSubagentOutput", () => {
	it("should_read_existing_file", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-test-"));
		const filePath = path.join(tmpDir, "output.md");
		fs.writeFileSync(filePath, "test content", "utf-8");
		expect(readSubagentOutput(filePath)).toBe("test content");
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("should_return_null_for_missing_file", () => {
		expect(readSubagentOutput("/nonexistent/path/file.md")).toBeNull();
	});
});
