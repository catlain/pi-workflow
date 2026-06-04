import { homedir } from "node:os";
import { join } from "node:path";

/** pi agent 根目录，默认 ~/.pi/agent */
export const AGENT_DIR = process.env.PI_AGENT_DIR || join(homedir(), ".pi/agent");
/** 子代理定义目录 ~/.pi/agent/agents/ */
export const AGENTS_DIR = join(AGENT_DIR, "agents");
