import type { Config } from "./config.js";

export type Platform = "messenger" | "instagram";

export interface GraphUser {
  id: string;
  name?: string;
  username?: string;
}

export interface GraphMessage {
  id: string;
  message?: string;
  from?: GraphUser;
  created_time: string;
}

export interface GraphConversation {
  id: string;
  updated_time?: string;
  unread_count?: number;
  participants?: { data: GraphUser[] };
  messages?: { data: GraphMessage[] };
}

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
  }
}

/** Graph API와 주고받는 부분만 모은 인터페이스예요. 테스트에서는 가짜로 바꿔 끼워요. */
export interface MetaApi {
  listConversations(platform: Platform, limit: number): Promise<GraphConversation[]>;
  getConversation(conversationId: string, messageLimit: number): Promise<GraphConversation>;
  sendText(recipientId: string, text: string): Promise<{ recipient_id?: string; message_id?: string }>;
  /** 이 페이지(와 연결된 인스타 계정)를 가리키는 ID들. 고객과 우리 쪽을 구분할 때 써요. */
  businessIds(): Promise<Set<string>>;
}

type FetchLike = typeof fetch;

export class GraphClient implements MetaApi {
  private businessIdsPromise?: Promise<Set<string>>;

  constructor(
    private readonly cfg: Config,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${this.cfg.graphBaseUrl}/${this.cfg.graphVersion}/${path.replace(/^\//, "")}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
    // 토큰은 URL이 아니라 헤더로만 보내요. 그래야 에러 메시지나 로그에 남지 않아요.
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.pageToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = undefined;
    }

    if (!res.ok || json?.error) {
      const err = json?.error ?? {};
      const msg = this.redact(String(err.message ?? text.slice(0, 300) ?? res.statusText));
      throw new GraphApiError(
        `Graph API 오류 (${res.status}${err.code ? `, code ${err.code}` : ""}): ${msg}`,
        res.status,
        err.code,
        err.error_subcode,
      );
    }
    if (json === undefined) {
      throw new GraphApiError(`Graph API 응답을 해석할 수 없어요 (${res.status})`, res.status);
    }
    return json as T;
  }

  private redact(s: string): string {
    return this.cfg.pageToken ? s.split(this.cfg.pageToken).join("[REDACTED]") : s;
  }

  async listConversations(platform: Platform, limit: number): Promise<GraphConversation[]> {
    const userFields = platform === "instagram" ? "id,username" : "id,name";
    const fields = [
      "id",
      "updated_time",
      ...(platform === "messenger" ? ["unread_count"] : []),
      `participants{${userFields}}`,
      `messages.limit(10){id,message,created_time,from}`,
    ].join(",");
    const res = await this.request<{ data: GraphConversation[] }>(
      "GET",
      this.url(`${this.cfg.pageId}/conversations`, { platform, fields, limit: String(limit) }),
    );
    return res.data ?? [];
  }

  async getConversation(conversationId: string, messageLimit: number): Promise<GraphConversation> {
    const fields = [
      "id",
      "updated_time",
      "participants",
      `messages.limit(${messageLimit}){id,message,created_time,from}`,
    ].join(",");
    return this.request<GraphConversation>("GET", this.url(conversationId, { fields }));
  }

  async sendText(recipientId: string, text: string) {
    // 메신저와 인스타그램 모두 페이지의 /messages 엔드포인트로 보내요.
    return this.request<{ recipient_id?: string; message_id?: string }>(
      "POST",
      this.url(`${this.cfg.pageId}/messages`),
      {
        recipient: { id: recipientId },
        messaging_type: "RESPONSE",
        message: { text },
      },
    );
  }

  businessIds(): Promise<Set<string>> {
    // 동시에 여러 도구가 불러도 조회는 한 번만 해요.
    this.businessIdsPromise ??= this.lookupBusinessIds();
    return this.businessIdsPromise;
  }

  private async lookupBusinessIds(): Promise<Set<string>> {
    const ids = new Set<string>([this.cfg.pageId]);
    if (this.cfg.igUserId) {
      ids.add(this.cfg.igUserId);
    } else {
      try {
        const page = await this.request<{ instagram_business_account?: { id: string } }>(
          "GET",
          this.url(this.cfg.pageId, { fields: "instagram_business_account" }),
        );
        if (page.instagram_business_account?.id) ids.add(page.instagram_business_account.id);
      } catch {
        // 인스타 계정을 못 찾아도 메신저는 동작해야 해요.
      }
    }
    return ids;
  }
}
