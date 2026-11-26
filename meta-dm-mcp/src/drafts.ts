import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Platform } from "./graph.js";

export type DraftStatus = "draft" | "sent" | "discarded";

export interface Draft {
  id: string;
  platform: Platform;
  conversationId: string;
  recipientId: string;
  recipientName?: string;
  text: string;
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  messageId?: string;
}

export interface SentRecord {
  draftId: string;
  platform: Platform;
  conversationId: string;
  recipientId: string;
  text: string;
  messageId?: string;
  sentAt: string;
}

/** 초안은 data/drafts.json, 발송 기록은 data/sent.jsonl에 저장해요. */
export class DraftStore {
  private readonly draftsPath: string;
  private readonly sentPath: string;

  constructor(private readonly dataDir: string) {
    this.draftsPath = join(dataDir, "drafts.json");
    this.sentPath = join(dataDir, "sent.jsonl");
  }

  private async readAll(): Promise<Draft[]> {
    try {
      return JSON.parse(await readFile(this.draftsPath, "utf8")) as Draft[];
    } catch (e: any) {
      if (e?.code === "ENOENT") return [];
      throw e;
    }
  }

  private async writeAll(drafts: Draft[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    // 임시 파일에 쓰고 바꿔치기해서, 중간에 멈춰도 파일이 깨지지 않게 해요.
    const tmp = `${this.draftsPath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(drafts, null, 2), "utf8");
    await rename(tmp, this.draftsPath);
  }

  async list(status?: DraftStatus): Promise<Draft[]> {
    const all = await this.readAll();
    return status ? all.filter((d) => d.status === status) : all;
  }

  async get(id: string): Promise<Draft | undefined> {
    return (await this.readAll()).find((d) => d.id === id);
  }

  async create(input: Omit<Draft, "id" | "status" | "createdAt" | "updatedAt">): Promise<Draft> {
    const now = new Date().toISOString();
    const draft: Draft = { ...input, id: randomUUID().slice(0, 8), status: "draft", createdAt: now, updatedAt: now };
    const all = await this.readAll();
    all.push(draft);
    await this.writeAll(all);
    return draft;
  }

  async update(id: string, patch: Partial<Omit<Draft, "id" | "createdAt">>): Promise<Draft> {
    const all = await this.readAll();
    const i = all.findIndex((d) => d.id === id);
    if (i < 0) throw new Error(`초안을 찾을 수 없어요: ${id}`);
    all[i] = { ...all[i], ...patch, updatedAt: new Date().toISOString() };
    await this.writeAll(all);
    return all[i];
  }

  async appendSent(record: SentRecord): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await appendFile(this.sentPath, JSON.stringify(record) + "\n", "utf8");
  }

  async readSent(): Promise<SentRecord[]> {
    try {
      const raw = await readFile(this.sentPath, "utf8");
      return raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as SentRecord);
    } catch (e: any) {
      if (e?.code === "ENOENT") return [];
      throw e;
    }
  }
}
