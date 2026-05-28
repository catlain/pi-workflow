/**
 * utils.ts 测试 — isSubagentSuccess（纯逻辑，无需 mock）
 */

import { describe, it, expect } from "vitest";
import { isSubagentSuccess } from "../utils";

describe("isSubagentSuccess", () => {
	it("should_return_true_for_exit_0_no_error", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "done" })).toBe(true);
	});

	it("should_return_true_for_exit_0_with_empty_error", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "done", error: "" })).toBe(true);
	});

	it("should_return_false_for_nonzero_exit_with_short_output", () => {
		expect(isSubagentSuccess({ exitCode: 1, output: "fail" })).toBe(false);
	});

	it("should_return_true_for_nonzero_exit_with_long_output", () => {
		expect(isSubagentSuccess({ exitCode: 1, output: "x".repeat(200) })).toBe(true);
	});

	it("should_return_false_for_no_output_string", () => {
		expect(isSubagentSuccess({ exitCode: 1, output: "(no output)" })).toBe(false);
	});

	it("should_return_false_for_timeout", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "ok", timedOut: true })).toBe(false);
	});

	it("should_return_false_for_error_string", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "ok", error: "crashed" })).toBe(false);
	});

	it("should_return_true_for_exit_0_with_explicit_timedOut_false", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "ok", timedOut: false })).toBe(true);
	});

	it("should_return_false_when_timedOut_is_true_even_with_long_output", () => {
		expect(isSubagentSuccess({ exitCode: 0, output: "x".repeat(200), timedOut: true })).toBe(false);
	});

	it("should_return_false_for_nonzero_exit_long_output_but_timedOut", () => {
		expect(isSubagentSuccess({ exitCode: 1, output: "x".repeat(200), timedOut: true })).toBe(false);
	});
});
