import type { GraphMessage } from "./graph.js";

/** Meta 표준 메시징 창: 고객의 마지막 메시지 후 24시간 */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReplyWindow {
  open: boolean;
  lastCustomerMessageAt: string | null;
  expiresAt: string | null;
  remainingMinutes: number;
}

/** 고객(우리 쪽 ID가 아닌 사람)이 보낸 가장 최근 메시지 시각 */
export function lastCustomerMessageAt(
  messages: GraphMessage[],
  businessIds: Set<string>,
): Date | null {
  let latest: Date | null = null;
  for (const m of messages) {
    if (!m.from?.id || businessIds.has(m.from.id)) continue;
    const t = new Date(m.created_time);
    if (Number.isNaN(t.getTime())) continue;
    if (!latest || t > latest) latest = t;
  }
  return latest;
}

export function replyWindow(lastAt: Date | null, now: Date = new Date()): ReplyWindow {
  if (!lastAt) {
    return { open: false, lastCustomerMessageAt: null, expiresAt: null, remainingMinutes: 0 };
  }
  const expires = new Date(lastAt.getTime() + REPLY_WINDOW_MS);
  const remainingMs = expires.getTime() - now.getTime();
  return {
    open: remainingMs > 0,
    lastCustomerMessageAt: lastAt.toISOString(),
    expiresAt: expires.toISOString(),
    remainingMinutes: Math.max(0, Math.floor(remainingMs / 60000)),
  };
}
