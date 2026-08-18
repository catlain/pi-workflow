/**
 * 测试 subagent.ts：validateOutputConstraints 纯函数
 */
import { describe, it, expect } from "vitest";
import { validateOutputConstraints } from "../subagent";

describe("validateOutputConstraints", () => {
	it("无约束时返回空列表", () => {
		expect(validateOutputConstraints("hello", [])).toEqual([]);
	});

	it("全部通过返回空列表", () => {
		const constraints = [
			{ rule: "必须是 JSON", validate: (s: string) => (s.startsWith("{") ? null : "not json") },
		];
		expect(validateOutputConstraints('{"ok":true}', constraints)).toEqual([]);
	});

	it("有不通过的返回错误列表", () => {
		const constraints = [
			{ rule: "必须是 JSON", validate: (s: string) => (s.startsWith("{") ? null : "not json") },
			{ rule: "包含 ok", validate: (s: string) => (s.includes("ok") ? null : "missing ok") },
		];
		expect(validateOutputConstraints("plain text", constraints)).toEqual(["not json", "missing ok"]);
	});

	it("部分通过只返回不通过的", () => {
		const constraints = [
			{ rule: "包含 ok", validate: (s: string) => (s.includes("ok") ? null : "missing ok") },
			{ rule: "包含 err", validate: (s: string) => (s.includes("err") ? null : "missing err") },
		];
		expect(validateOutputConstraints("has ok but not e", constraints)).toEqual(["missing err"]);
	});
});
