/**
 * 测试 SubagentSession — 输出收集 / 事件解析 / 退出控制
 */
import { describe, it, expect } from "vitest";
import { SubagentSession } from "../subagent-session";

describe("SubagentSession", () => {
	it("collectTexts 收集 assistant 文本，忽略其他角色", () => {
		const s = new SubagentSession();
		s.collectTexts({ role: "user", content: [{ type: "text", text: "hi" }] });
		s.collectTexts({ role: "assistant", content: [{ type: "text", text: "answer" }] });
		s.collectTexts({ role: "assistant", content: [{ type: "toolCall", id: "t1" }] });
		expect(s.formatOutput("fallback")).toBe("answer");
	});

	it("formatOutput 去重重复文本块", () => {
		const s = new SubagentSession();
		s.collectTexts({ role: "assistant", content: [{ type: "text", text: "same" }] });
		s.collectTexts({ role: "assistant", content: [{ type: "text", text: "same" }] });
		expect(s.formatOutput("fallback")).toBe("same");
	});

	it("无收集文本时返回 fallback", () => {
		const s = new SubagentSession();
		expect(s.formatOutput("(no output)")).toBe("(no output)");
	});

	it("parseStreamEvent 捕获 session id（仅首次）", () => {
		const s = new SubagentSession();
		s.parseStreamEvent({ type: "session", version: 1, id: "sess-1" });
		s.parseStreamEvent({ type: "session", version: 1, id: "sess-2" });
		expect(s.capturedSessionId).toBe("sess-1");
	});

	it("parseStreamEvent 转发 tool / thinking 事件", () => {
		const events: any[] = [];
		const s = new SubagentSession({ onEvent: (e) => events.push(e) });
		s.parseStreamEvent({ type: "tool_execution_start", toolName: "read", args: {} });
		s.parseStreamEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } });
		expect(events).toEqual([
			{ type: "tool", toolName: "read", toolArgs: {} },
			{ type: "thinking", text: "hi" },
		]);
	});

	it("parseStreamEvent message_end / agent_end 收集文本", () => {
		const s = new SubagentSession();
		s.parseStreamEvent({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "a" }] } });
		s.parseStreamEvent({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "b" }] }] });
		expect(s.formatOutput("")).toBe("a\n\n---\n\nb");
	});

	it("parseSessionLine 解析 message / tool / agent_end", () => {
		const events: any[] = [];
		const s = new SubagentSession({ onEvent: (e) => events.push(e) });
		s.parseSessionLine({ type: "session", id: "s1" });
		s.parseSessionLine({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "txt" }] } });
		s.parseSessionLine({ type: "tool_execution_start", toolName: "bash", args: {} });
		s.parseSessionLine({ type: "agent_end", messages: [] });
		expect(s.capturedSessionId).toBe("s1");
		expect(s.formatOutput("")).toBe("txt");
		expect(events).toEqual([{ type: "tool", toolName: "bash", toolArgs: {} }]);
	});

	it("resolveOnce 只生效一次，并自动附加 capturedSessionId", async () => {
		const s = new SubagentSession();
		s.parseStreamEvent({ type: "session", version: 1, id: "sess-9" });
		s.resolveOnce({ exitCode: 0, output: "x", stderr: "" });
		s.resolveOnce({ exitCode: 1, output: "y", stderr: "" });
		const result = await s.result;
		expect(result.output).toBe("x");
		expect(result.subSessionId).toBe("sess-9");
		expect(s.isDone).toBe(true);
	});

	it("beforeResolve 在 resolve 前被调用（如注入 parentSession）", async () => {
		const calls: string[] = [];
		const s = new SubagentSession({ beforeResolve: () => calls.push("before") });
		s.resolveOnce({ exitCode: 0, output: "x", stderr: "" });
		await s.result;
		expect(calls).toEqual(["before"]);
	});
});
