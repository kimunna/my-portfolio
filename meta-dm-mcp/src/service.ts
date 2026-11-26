import type { Config } from "./config.js";
import type { DraftStore, Draft } from "./drafts.js";
import type { GraphConversation, GraphUser, MetaApi, Platform } from "./graph.js";
import { lastCustomerMessageAt, replyWindow, type ReplyWindow } from "./window.js";

/** 메신저 2000자, 인스타그램 1000바이트(UTF-8)가 텍스트 한도예요. */
export function checkTextLimit(platform: Platform, text: string): string | null {
  if (!text.trim()) return "메시지 내용이 비어 있어요.";
  if (platform === "messenger" && [...text].length > 2000) {
    return `메신저 메시지는 2000자까지 보낼 수 있어요. (현재 ${[...text].length}자)`;
  }
  if (platform === "instagram" && Buffer.byteLength(text, "utf8") > 1000) {
    return `인스타그램 메시지는 1000바이트까지 보낼 수 있어요. 한글은 한 글자에 3바이트라 약 330자예요. (현재 ${Buffer.byteLength(text, "utf8")}바이트)`;
  }
  return null;
}

export class UserFacingError extends Error {}

function displayName(u?: GraphUser): string | undefined {
  return u?.username ?? u?.name;
}

export interface ConversationSummary {
  conversationId: string;
  platform: Platform;
  customer: { id: string; name?: string } | null;
  lastMessage: { text?: string; fromCustomer: boolean; at: string } | null;
  needsReply: boolean;
  unreadCount?: number;
  replyWindow: ReplyWindow;
}

export class DmService {
  /** 동시에 같은 초안을 두 번 보내지 않도록 잠가요. */
  private sending = new Set<string>();

  constructor(
    private readonly cfg: Config,
    private readonly api: MetaApi,
    private readonly store: DraftStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private customerOf(conv: GraphConversation, biz: Set<string>): GraphUser | null {
    return conv.participants?.data.find((p) => !biz.has(p.id)) ?? null;
  }

  private summarize(conv: GraphConversation, platform: Platform, biz: Set<string>): ConversationSummary {
    const messages = conv.messages?.data ?? [];
    const latest = [...messages].sort((a, b) => b.created_time.localeCompare(a.created_time))[0];
    const customer = this.customerOf(conv, biz);
    const fromCustomer = !!latest?.from?.id && !biz.has(latest.from.id);
    return {
      conversationId: conv.id,
      platform,
      customer: customer ? { id: customer.id, name: displayName(customer) } : null,
      lastMessage: latest ? { text: latest.message, fromCustomer, at: latest.created_time } : null,
      needsReply: fromCustomer,
      unreadCount: conv.unread_count,
      replyWindow: replyWindow(lastCustomerMessageAt(messages, biz), this.now()),
    };
  }

  async listConversations(opts: {
    platform: Platform | "all";
    limit: number;
    needsReplyOnly: boolean;
  }): Promise<ConversationSummary[]> {
    const biz = await this.api.businessIds();
    const platforms: Platform[] = opts.platform === "all" ? ["messenger", "instagram"] : [opts.platform];
    const out: ConversationSummary[] = [];
    for (const p of platforms) {
      const convs = await this.api.listConversations(p, opts.limit);
      out.push(...convs.map((c) => this.summarize(c, p, biz)));
    }
    const filtered = opts.needsReplyOnly ? out.filter((c) => c.needsReply) : out;
    return filtered.sort((a, b) => (b.lastMessage?.at ?? "").localeCompare(a.lastMessage?.at ?? ""));
  }

  async getConversation(conversationId: string, platform: Platform, messageLimit: number) {
    const biz = await this.api.businessIds();
    const conv = await this.api.getConversation(conversationId, messageLimit);
    const messages = (conv.messages?.data ?? [])
      .map((m) => ({
        id: m.id,
        from: displayName(m.from) ?? m.from?.id,
        fromCustomer: !!m.from?.id && !biz.has(m.from.id),
        text: m.message,
        at: m.created_time,
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
    return { ...this.summarize(conv, platform, biz), messages };
  }

  /** 대화를 다시 불러와 받는 사람과 24시간 창을 확인해요. */
  private async resolveTarget(conversationId: string) {
    const biz = await this.api.businessIds();
    const conv = await this.api.getConversation(conversationId, 25);
    const customer = this.customerOf(conv, biz);
    if (!customer) throw new UserFacingError("이 대화에서 고객을 찾을 수 없어요.");
    const window = replyWindow(lastCustomerMessageAt(conv.messages?.data ?? [], biz), this.now());
    return { customer, window };
  }

  private windowClosedMessage(w: ReplyWindow): string {
    return w.lastCustomerMessageAt
      ? `24시간 답장 가능 시간이 지났어요. 고객의 마지막 메시지: ${w.lastCustomerMessageAt}, 마감: ${w.expiresAt}. 고객이 다시 메시지를 보내면 답장할 수 있어요.`
      : "고객이 보낸 메시지가 없어서 먼저 메시지를 보낼 수 없어요.";
  }

  async createDraft(input: { conversationId: string; platform: Platform; text: string }): Promise<{ draft: Draft; replyWindow: ReplyWindow }> {
    const limitErr = checkTextLimit(input.platform, input.text);
    if (limitErr) throw new UserFacingError(limitErr);
    const { customer, window } = await this.resolveTarget(input.conversationId);
    if (!window.open) throw new UserFacingError(this.windowClosedMessage(window));
    const draft = await this.store.create({
      platform: input.platform,
      conversationId: input.conversationId,
      recipientId: customer.id,
      recipientName: displayName(customer),
      text: input.text,
    });
    return { draft, replyWindow: window };
  }

  async updateDraft(id: string, text: string): Promise<Draft> {
    const d = await this.requireDraft(id, "draft");
    const limitErr = checkTextLimit(d.platform, text);
    if (limitErr) throw new UserFacingError(limitErr);
    return this.store.update(id, { text });
  }

  async discardDraft(id: string): Promise<Draft> {
    await this.requireDraft(id, "draft");
    return this.store.update(id, { status: "discarded" });
  }

  listDrafts(status?: Draft["status"]) {
    return this.store.list(status);
  }

  private async requireDraft(id: string, status: Draft["status"]): Promise<Draft> {
    const d = await this.store.get(id);
    if (!d) throw new UserFacingError(`초안을 찾을 수 없어요: ${id}`);
    if (d.status !== status) {
      throw new UserFacingError(
        d.status === "sent"
          ? `이미 보낸 초안이에요 (${d.sentAt}). 같은 메시지를 두 번 보내지 않아요.`
          : `이 초안은 상태가 '${d.status}'라서 사용할 수 없어요.`,
      );
    }
    return d;
  }

  private async checkRateLimit(): Promise<void> {
    const sent = await this.store.readSent();
    const now = this.now().getTime();
    const last = sent.at(-1);
    if (last) {
      const elapsedSec = (now - new Date(last.sentAt).getTime()) / 1000;
      if (elapsedSec < this.cfg.minSendIntervalSec) {
        throw new UserFacingError(
          `너무 빨리 보내고 있어요. ${Math.ceil(this.cfg.minSendIntervalSec - elapsedSec)}초 뒤에 다시 시도해 주세요.`,
        );
      }
    }
    const lastHour = sent.filter((r) => now - new Date(r.sentAt).getTime() < 3600_000).length;
    if (lastHour >= this.cfg.maxSendsPerHour) {
      throw new UserFacingError(
        `최근 1시간 동안 ${lastHour}건을 보냈어요. 한도(${this.cfg.maxSendsPerHour}건)에 도달했어요.`,
      );
    }
  }

  async sendDraft(id: string) {
    if (this.sending.has(id)) throw new UserFacingError("이 초안은 지금 보내는 중이에요.");
    this.sending.add(id);
    try {
      const draft = await this.requireDraft(id, "draft");
      const limitErr = checkTextLimit(draft.platform, draft.text);
      if (limitErr) throw new UserFacingError(limitErr);

      // 초안을 만든 뒤 시간이 지났을 수 있으니 발송 직전에 다시 확인해요.
      const { customer, window } = await this.resolveTarget(draft.conversationId);
      if (customer.id !== draft.recipientId) {
        throw new UserFacingError("대화의 고객 정보가 초안과 달라요. 초안을 새로 만들어 주세요.");
      }
      if (!window.open) throw new UserFacingError(this.windowClosedMessage(window));

      if (this.cfg.dryRun) {
        return {
          dryRun: true,
          note: "META_DRY_RUN이 켜져 있어서 실제로 보내지 않았어요. 실제 발송하려면 META_DRY_RUN=false로 바꿔 주세요.",
          wouldSend: { platform: draft.platform, to: draft.recipientName ?? draft.recipientId, text: draft.text },
          replyWindow: window,
        };
      }

      await this.checkRateLimit();
      const res = await this.api.sendText(draft.recipientId, draft.text);
      const sentAt = this.now().toISOString();
      const updated = await this.store.update(id, { status: "sent", sentAt, messageId: res.message_id });
      await this.store.appendSent({
        draftId: id,
        platform: draft.platform,
        conversationId: draft.conversationId,
        recipientId: draft.recipientId,
        text: draft.text,
        messageId: res.message_id,
        sentAt,
      });
      return { dryRun: false, sent: updated };
    } finally {
      this.sending.delete(id);
    }
  }
}
