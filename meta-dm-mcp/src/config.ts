import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** meta-dm-mcp 패키지 폴더 (dist/ 또는 src/ 한 단계 위) */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Config {
  pageId: string;
  pageToken: string;
  /** 비워두면 페이지에 연결된 인스타그램 계정을 API로 찾아요. */
  igUserId?: string;
  graphVersion: string;
  graphBaseUrl: string;
  dataDir: string;
  /** true면 실제로 보내지 않고 미리보기만 돌려줘요. 기본값 true. */
  dryRun: boolean;
  minSendIntervalSec: number;
  maxSendsPerHour: number;
}

/** 패키지 폴더의 .env를 읽어요. 이미 설정된 환경변수는 덮어쓰지 않아요. */
export function loadDotEnv(path = resolve(PACKAGE_ROOT, ".env")): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch {
    // .env 형식이 잘못됐어도 서버는 떠야 해요. 설정 오류는 도구 호출 때 알려줘요.
  }
}

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new ConfigError(`${key} 값이 올바르지 않아요: "${raw}" (0 이상의 숫자여야 해요)`);
  }
  return n;
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const pageId = read(env, "META_PAGE_ID");
  const pageToken = read(env, "META_PAGE_TOKEN");
  const missing = [!pageId && "META_PAGE_ID", !pageToken && "META_PAGE_TOKEN"].filter(Boolean);
  if (missing.length > 0) {
    throw new ConfigError(
      `필수 설정이 없어요: ${missing.join(", ")}. meta-dm-mcp/.env.example을 참고해 .env를 만들어 주세요.`,
    );
  }

  const dryRunRaw = (read(env, "META_DRY_RUN") ?? "true").toLowerCase();
  const graphVersion = read(env, "META_GRAPH_VERSION") ?? "v24.0";

  return {
    pageId: pageId!,
    pageToken: pageToken!,
    igUserId: read(env, "META_IG_USER_ID"),
    graphVersion,
    graphBaseUrl: read(env, "META_GRAPH_BASE_URL") ?? "https://graph.facebook.com",
    dataDir: resolve(read(env, "META_DM_DATA_DIR") ?? resolve(PACKAGE_ROOT, "data")),
    dryRun: !["false", "0", "no", "off"].includes(dryRunRaw),
    minSendIntervalSec: readInt(env, "META_MIN_SEND_INTERVAL_SEC", 5),
    maxSendsPerHour: readInt(env, "META_MAX_SENDS_PER_HOUR", 30),
  };
}
