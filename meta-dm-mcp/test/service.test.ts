import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { DraftStore } from "../src/drafts.js";
import { GraphClient, type GraphConversation, type MetaApi } from "../src/graph.js";
import { checkTextLimit, DmService } from "../src/service.js";
import { lastCustomerMessageAt, replyWindow } from "../src/window.js";

const PAGE = "page-1";
const CUSTOMER = "cust-9";
const NOW = new Date("2026-11-26T12:00:00Z");

function hoursAgo(h: number) {
  return new Date(NOW.getTime() - h * 3600_000).toISOString();
}

function conversation(lastCustomerHoursAgo: number): GraphConversation {
  return {
    id: "conv-1",
    participants: { data: [{ id: PAGE, name: "My Shop" }, { id: CUSTOMER, name: "고객님" }] },
    messages: {
      data: [
        { id: "m2", message: "네 확인해볼게요", from: { id: PAGE }, created_time: hoursAgo(lastCustomerHoursAgo - 0.5) },
        { id: "m1", message: "배송 언제 와요?", from: { id: CUSTOMER }, created_time: hoursAgo(lastCustomerHoursAgo) },
      ],
    },
  };
}

class FakeApi implements MetaApi {
  conv = conversation(2);
  sendText = vi.fn(async () => ({ recipient_id: CUSTOMER, message_id: "mid.1" }));
  async listConversations() {
    return [this.conv];
  }
  async getConversation() {
    return this.conv;
  }
  async businessIds() {
    return new Set([PAGE]);
  }
}

let dir: string;
let api: FakeApi;
let cfg: Config;
let now: Date;
let svc: DmService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "meta-dm-"));
  api = new FakeApi();
  now = NOW;
  cfg = loadConfig({
    META_PAGE_ID: PAGE,
    META_PAGE_TOKEN: "secret-token",
    META_DM_DATA_DIR: dir,
    META_DRY_RUN: "false",
    META_MIN_SEND_INTERVAL_SEC: "0",
  });
  svc = new DmService(cfg, api, new DraftStore(dir), () => now);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("24시간 답장 창", () => {
  it("우리 쪽 메시지는 빼고 고객의 마지막 메시지를 기준으로 해요", () => {
    const last = lastCustomerMessageAt(conversation(5).messages!.data, new Set([PAGE]));
    expect(last?.toISOString()).toBe(hoursAgo(5));
  });

  it("23시간 전이면 열려 있고 24시간이 지나면 닫혀요", () => {
    expect(replyWindow(new Date(hoursAgo(23)), NOW)).toMatchObject({ open: true, remainingMinutes: 60 });
    expect(replyWindow(new Date(hoursAgo(24.1)), NOW).open).toBe(false);
    expect(replyWindow(null, NOW).open).toBe(false);
  });
});

describe("텍스트 길이 제한", () => {
  it("인스타그램은 1000바이트, 메신저는 2000자", () => {
    expect(checkTextLimit("instagram", "가".repeat(333))).toBeNull();
    expect(checkTextLimit("instagram", "가".repeat(334))).toMatch(/1000바이트/);
    expect(checkTextLimit("messenger", "가".repeat(2000))).toBeNull();
    expect(checkTextLimit("messenger", "가".repeat(2001))).toMatch(/2000자/);
    expect(checkTextLimit("messenger", "   ")).toMatch(/비어/);
  });
});

describe("대화 목록", () => {
  it("고객이 마지막으로 보냈으면 needsReply가 true예요", async () => {
    api.conv.messages!.data = api.conv.messages!.data.filter((m) => m.from?.id === CUSTOMER);
    const [c] = await svc.listConversations({ platform: "messenger", limit: 10, needsReplyOnly: false });
    expect(c.customer).toEqual({ id: CUSTOMER, name: "고객님" });
    expect(c.needsReply).toBe(true);
    expect(c.replyWindow.open).toBe(true);
  });

  it("needsReplyOnly면 우리가 마지막으로 답한 대화는 빠져요", async () => {
    const list = await svc.listConversations({ platform: "messenger", limit: 10, needsReplyOnly: true });
    expect(list).toHaveLength(0);
  });
});

describe("초안 → 발송", () => {
  it("초안을 만들고 보내면 기록이 남고 두 번 보낼 수 없어요", async () => {
    const { draft } = await svc.createDraft({ conversationId: "conv-1", platform: "messenger", text: "내일 도착해요!" });
    expect(draft.recipientId).toBe(CUSTOMER);
    expect(api.sendText).not.toHaveBeenCalled();

    const res = await svc.sendDraft(draft.id);
    expect(res.dryRun).toBe(false);
    expect(api.sendText).toHaveBeenCalledWith(CUSTOMER, "내일 도착해요!");

    await expect(svc.sendDraft(draft.id)).rejects.toThrow(/이미 보낸/);
    expect(api.sendText).toHaveBeenCalledTimes(1);
    expect(await new DraftStore(dir).readSent()).toHaveLength(1);
  });

  it("24시간이 지난 대화는 초안을 만들 수 없어요", async () => {
    api.conv = conversation(25);
    await expect(
      svc.createDraft({ conversationId: "conv-1", platform: "messenger", text: "안녕하세요" }),
    ).rejects.toThrow(/24시간/);
  });

  it("초안을 만든 뒤 24시간이 지나면 발송 직전에 막아요", async () => {
    const { draft } = await svc.createDraft({ conversationId: "conv-1", platform: "messenger", text: "안녕하세요" });
    now = new Date(NOW.getTime() + 23 * 3600_000);
    await expect(svc.sendDraft(draft.id)).rejects.toThrow(/24시간/);
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it("드라이런이면 실제로 보내지 않고 초안도 그대로 남아요", async () => {
    const dry = new DmService({ ...cfg, dryRun: true }, api, new DraftStore(dir), () => now);
    const { draft } = await dry.createDraft({ conversationId: "conv-1", platform: "messenger", text: "테스트" });
    const res = await dry.sendDraft(draft.id);
    expect(res.dryRun).toBe(true);
    expect(api.sendText).not.toHaveBeenCalled();
    expect((await dry.listDrafts("draft")).map((d) => d.id)).toContain(draft.id);
  });

  it("버린 초안은 보낼 수 없어요", async () => {
    const { draft } = await svc.createDraft({ conversationId: "conv-1", platform: "messenger", text: "테스트" });
    await svc.discardDraft(draft.id);
    await expect(svc.sendDraft(draft.id)).rejects.toThrow(/discarded/);
  });

  it("시간당 발송 한도를 넘으면 막아요", async () => {
    const limited = new DmService({ ...cfg, maxSendsPerHour: 1 }, api, new DraftStore(dir), () => now);
    const a = await limited.createDraft({ conversationId: "conv-1", platform: "messenger", text: "1" });
    const b = await limited.createDraft({ conversationId: "conv-1", platform: "messenger", text: "2" });
    await limited.sendDraft(a.draft.id);
    await expect(limited.sendDraft(b.draft.id)).rejects.toThrow(/한도/);
  });
});

describe("설정", () => {
  it("META_DRY_RUN을 안 쓰면 기본은 드라이런이에요", () => {
    expect(loadConfig({ META_PAGE_ID: "p", META_PAGE_TOKEN: "t" }).dryRun).toBe(true);
  });

  it("필수 값이 없으면 알려줘요", () => {
    expect(() => loadConfig({})).toThrow(/META_PAGE_ID, META_PAGE_TOKEN/);
  });
});

describe("Graph API 클라이언트", () => {
  it("토큰은 헤더로만 보내고 에러 메시지에서는 가려요", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Invalid token secret-token", code: 190 } }), { status: 400 }),
    );
    const client = new GraphClient(cfg, fetchMock as unknown as typeof fetch);
    await expect(client.sendText(CUSTOMER, "hi")).rejects.toThrow(/\[REDACTED\]/);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/${cfg.graphVersion}/${PAGE}/messages`);
    expect(url).not.toContain("secret-token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { id: CUSTOMER },
      messaging_type: "RESPONSE",
      message: { text: "hi" },
    });
  });
});
