# meta-dm-mcp

페이스북 메신저와 인스타그램 DM을 Claude Code에서 다루는 MCP 서버예요.
**초안 → 사람이 확인 → 발송** 순서로만 메시지를 보내요.

## 1. Meta 쪽 준비
1. 페이스북 페이지와 인스타그램 **프로페셔널 계정**을 연결해요.
2. [Meta for Developers](https://developers.facebook.com/)에서 **비즈니스 유형 앱**을 만들어요.
3. Messenger와 Instagram 제품을 추가하고, 아래 권한을 받아요.
   - `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`
   - `instagram_basic`, `instagram_manage_messages`
4. 장기 **페이지 액세스 토큰**을 발급해요. 가능하면 비즈니스 설정의 시스템 사용자 토큰을 써요.
5. 인스타그램 앱 설정에서 **메시지 접근 허용**(연결된 도구 허용)을 켜요.
6. 처음엔 **개발 모드**로 테스트해요. 앱 역할(관리자·테스터) 계정만 주고받을 수 있어요.
7. 실제 고객에게 쓰려면 **앱 검수와 비즈니스 인증**이 필요해요.

## 2. 설치
```bash
cd meta-dm-mcp
npm install
npm run build
cp .env.example .env   # 값 채우기
```

저장소 루트의 `.mcp.json`이 이 서버를 `meta-dm`이라는 이름으로 등록해요.
Claude Code를 저장소 루트에서 열면 `/mcp`로 연결 상태를 볼 수 있어요.

## 3. 쓰는 법
Claude Code에서 이렇게 말하면 돼요.
- "새 DM 확인하고 답장 초안 만들어줘"
- "/dm-inbox"

`dm-inbox` 스킬(`.claude/skills/dm-inbox/SKILL.md`)이 순서와 말투를 정해줘요.
말투와 FAQ는 사업에 맞게 꼭 고쳐 주세요.

## 도구
| 도구 | 하는 일 |
|---|---|
| `list_conversations` | 대화 목록, 답장 필요 여부, 24시간 남은 시간 |
| `get_conversation` | 한 대화의 메시지 |
| `create_draft` | 초안 저장 (보내지 않음) |
| `list_drafts` / `update_draft` / `discard_draft` | 초안 관리 |
| `send_draft` | 승인된 초안 발송 |

## 안전장치
- 임의 텍스트를 바로 보내는 도구는 없어요. 반드시 초안을 거쳐요.
- `.claude/settings.json`에서 `send_draft`는 매번 승인 창이 뜨게 했어요.
- 고객의 마지막 메시지 후 24시간이 지나면 초안 생성과 발송을 모두 막아요.
- 같은 초안은 한 번만 보내요.
- **`META_DRY_RUN`의 기본값은 `true`예요.** 실제 발송은 `false`로 바꿔야 해요.
- 발송 간격(`META_MIN_SEND_INTERVAL_SEC`)과 시간당 한도(`META_MAX_SENDS_PER_HOUR`)가 있어요.
- 토큰은 URL이 아니라 헤더로만 보내고, 에러 메시지에서도 가려요.
- 초안은 `data/drafts.json`, 발송 기록은 `data/sent.jsonl`에 남아요. (git 제외)

## 확인 방법
```bash
npm test          # 단위 테스트
npm run inspect   # MCP Inspector로 도구 직접 호출
```

## 나중에 추가할 수 있는 것
- 게시물 댓글에 비공개 답장 (댓글 후 7일 안 1회)
- 웹훅으로 새 메시지 실시간 수신
- 정해진 시간마다 받은편지함 점검
