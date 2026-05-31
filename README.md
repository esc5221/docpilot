# docpilot

> Cursor for documents — 파일 하나를 계속 붙잡고, 문장/문단 단위로 AI(Codex)가 고쳐주는 데스크탑 문서 편집기.

로컬 ChatGPT/Codex **구독**을 그대로 써서(API 키 결제 없음) 선택한 부분만 수술적으로 수정한다. 세션·캐시·컴팩팅은 Codex가 알아서 관리한다.

## 구조

```
docpilot/
  packages/shared/   프론트 ↔ 사이드카 공유 타입 (단일 진실 원천)
  sidecar/           Node 에이전트 서버. @openai/codex-sdk 래핑, 127.0.0.1 SSE
  app/
    src/             React 프론트
      agent/         사이드카 HTTP/SSE 클라이언트
      editor/        EditorAdapter(추상) + Tiptap(md) / docx-editor(docx) 어댑터
      inline-edit/   선택→지시→스트림→diff→수락/거절 (제품의 심장)
      chat/          오른쪽 날개 채팅
      documents/     파일 열기·저장, 문서↔threadId 매핑
    src-tauri/       Rust 셸: 사이드카 생명주기 + 파일 IO + threadId 저장
```

데이터는 항상 `plain text + range`로만 레이어를 흐른다. AI 레이어는 ProseMirror도 파일 포맷도 모른다 — `EditRequest`를 받고 `EditStreamEvent`를 돌려줄 뿐이다. 그래서 Codex→Claude, md→docx 교체가 어댑터 교체로 끝난다.

## 전제

- [Codex CLI](https://developers.openai.com/codex/cli) 설치 + `codex login` (ChatGPT 구독)
- Node 18+ (사이드카는 **Node로 실행** — Bun 런타임은 codex-sdk와 readline 충돌)
- Rust + `cargo`, macOS면 Xcode CLT

## 실행 (로컬 개발)

```bash
# 1) 공유 의존성
cd sidecar && bun install      # 또는 npm install
cd ../app && npm install

# 2) 사이드카 번들 (Rust 셸이 dist/index.js 를 spawn 한다)
cd ../sidecar && npm run build

# 3) 앱 실행 (vite + tauri)
cd ../app && npm run tauri dev
```

사이드카 코드를 고치면 `sidecar`에서 `npm run build`를 다시 돌리고 앱을 재시작한다.

## 사용법

1. 상단 **열기**로 `sample.md`(마크다운) 또는 `sample.docx`(Word)를 연다.
2. 문장/문단을 드래그하고 **⌘K**.
3. 지시를 입력하거나 빠른 칩(더 간결하게 등)을 누른다.
4. AI가 선택 부분만 새로 써서 diff로 보여준다 → **⏎ 수락** / **Esc 거절**.
5. **⌘S** 저장. 문서에 묶인 codex thread id가 저장돼, 다시 열면 같은 세션을 resume하고 프롬프트 캐시가 살아있다.

오른쪽 패널은 문서 전체에 대한 자유 채팅(제목·구조·조언 등).

## 동작 원리 한 줄

- 문서당 codex thread 1개 → `~/.codex/sessions`에 영속 + `app_data/threads.json`에 매핑
- 같은 thread를 계속 `run()` → 프롬프트 캐시 히트(검증: 2nd edit `cachedInputTokens` 0→1만+)
- context 길어지면 Codex가 자동 컴팩팅 — 우리가 손대지 않음
- AI 출력은 항상 "교체본만". 전체 재작성 금지. 수락 전엔 문서 불변, 수락은 트랜잭션 1건이라 ⌘Z로 되돌림
