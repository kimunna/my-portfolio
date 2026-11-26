#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigError, loadConfig, loadDotEnv } from "./config.js";
import { DraftStore } from "./drafts.js";
import { GraphApiError, GraphClient } from "./graph.js";
import { DmService, UserFacingError } from "./service.js";

loadDotEnv();

let service: DmService | undefined;
function getService(): DmService {
  // 설정이 없어도 서버는 뜨고, 도구를 부를 때 무엇이 빠졌는지 알려줘요.
  if (!service) {
    const cfg = loadConfig();
    service = new DmService(cfg, new GraphClient(cfg), new DraftStore(cfg.dataDir));
  }
  return service;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown) {
  const known = e instanceof UserFacingError || e instanceof ConfigError || e instanceof GraphApiError;
  const text = known ? (e as Error).message : `예상하지 못한 오류: ${e instanceof Error ? e.message : String(e)}`;
  return { isError: true, content: [{ type: "text" as const, text }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

const platform = z.enum(["messenger", "instagram"]).describe("messenger(페이스북) 또는 instagram");

const server = new McpServer({ name: "meta-dm", version: "0.1.0" });

server.registerTool(
  "list_conversations",
  {
    title: "DM 대화 목록",
    description:
      "페이스북 메신저와 인스타그램 DM 대화 목록을 최신순으로 보여줘요. 각 대화에 답장이 필요한지(needsReply)와 24시간 답장 가능 시간(replyWindow)이 표시돼요.",
    inputSchema: {
      platform: z.enum(["messenger", "instagram", "all"]).default("all"),
      limit: z.number().int().min(1).max(50).default(20).describe("플랫폼별 최대 대화 수"),
      needs_reply_only: z.boolean().default(false).describe("true면 고객 메시지가 마지막인 대화만"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ platform, limit, needs_reply_only }) =>
    run(() => getService().listConversations({ platform, limit, needsReplyOnly: needs_reply_only })),
);

server.registerTool(
  "get_conversation",
  {
    title: "DM 대화 내용",
    description: "한 대화의 최근 메시지를 오래된 순서로 보여줘요.",
    inputSchema: {
      conversation_id: z.string().min(1),
      platform,
      message_limit: z.number().int().min(1).max(100).default(20),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ conversation_id, platform, message_limit }) =>
    run(() => getService().getConversation(conversation_id, platform, message_limit)),
);

server.registerTool(
  "create_draft",
  {
    title: "답장 초안 만들기",
    description:
      "고객에게 보낼 답장 초안을 저장해요. 실제로 보내지는 않아요. 고객의 마지막 메시지 후 24시간이 지났으면 거부해요. 사람이 확인한 뒤 send_draft로 보내요.",
    inputSchema: {
      conversation_id: z.string().min(1),
      platform,
      text: z.string().min(1).describe("보낼 메시지 내용"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  ({ conversation_id, platform, text }) =>
    run(() => getService().createDraft({ conversationId: conversation_id, platform, text })),
);

server.registerTool(
  "list_drafts",
  {
    title: "초안 목록",
    description: "저장된 초안을 보여줘요. 기본은 아직 보내지 않은 초안만이에요.",
    inputSchema: { status: z.enum(["draft", "sent", "discarded"]).default("draft") },
    annotations: { readOnlyHint: true },
  },
  ({ status }) => run(() => getService().listDrafts(status)),
);

server.registerTool(
  "update_draft",
  {
    title: "초안 고치기",
    description: "아직 보내지 않은 초안의 내용을 바꿔요.",
    inputSchema: { draft_id: z.string().min(1), text: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ draft_id, text }) => run(() => getService().updateDraft(draft_id, text)),
);

server.registerTool(
  "discard_draft",
  {
    title: "초안 버리기",
    description: "아직 보내지 않은 초안을 버려요. 버린 초안은 보낼 수 없어요.",
    inputSchema: { draft_id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  ({ draft_id }) => run(() => getService().discardDraft(draft_id)),
);

server.registerTool(
  "send_draft",
  {
    title: "초안 발송",
    description:
      "사람이 확인한 초안 하나를 고객에게 실제로 보내요. 반드시 사용자가 이 초안을 보내라고 승인한 뒤에만 부르세요. 발송 직전에 24시간 답장 가능 시간을 다시 확인하고, 같은 초안은 한 번만 보내요. META_DRY_RUN이 켜져 있으면 미리보기만 돌려줘요.",
    inputSchema: { draft_id: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  ({ draft_id }) => run(() => getService().sendDraft(draft_id)),
);

await server.connect(new StdioServerTransport());
