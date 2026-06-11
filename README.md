# docpilot

> Cursor for documents — 파일 하나를 계속 붙잡고, 문장/문단 단위로 AI(Codex)가 고쳐주는 데스크탑 문서 편집기.

로컬 ChatGPT/Codex **구독**을 그대로 써서(API 키 결제 없음) 선택한 부분만 수술적으로 수정한다. 세션·캐시·컴팩팅은 Codex가 알아서 관리한다.

## 핵심 기능

- **인라인 편집 (⌘K)** — 선택 → 지시 → 스트리밍 → old/new diff → **⏎ 수락** / **Esc 거절**. 수락 전엔 문서 불변, 수락은 트랜잭션 1건(⌘Z 복구). 문서별 codex thread를 resume해 프롬프트 캐시가 살아있다.
- **에이전틱 편집 (채팅 Edit 모드)** — Codex가 문서 파일을 직접 읽고·고치고·검증. 도구 호출/추론 타임라인 + 변경 라인 diff + 원클릭 Revert.
- **Ask 채팅** — 문서 전체에 대한 대화. 마크다운 렌더링, **Stop**(서버측 `turn/interrupt`까지 전파), 메시지 복사, 세션 관리.
- **멀티탭** — md/docx 동시 작업, 재시작 시 탭 복원, 미저장 가드(탭 닫기·앱 종료 확인).
- **커맨드 팔레트 (⌘P)** — 모든 액션·최근 파일·헤딩 점프.
- **찾기 (⌘F)** — md 전체 하이라이트 + prev/next, docx 단락 점프.
- **버블 메뉴** — 마크다운 선택 시 서식(B/I/S/code/H1-3/리스트/인용) + **✦ AI Edit** 진입점.
- **그 외** — 사이드바 아웃라인, 상태바(단어 수·선택 길이·AI 연결 상태·테마 토글), 드래그앤드롭으로 열기, 네이티브 메뉴(File/Edit/View), 라이트/다크 테마, 단축키 도움말(⌘/), 웰컴 화면.

## 단축키

```
⌘N 새 문서      ⌘O 열기        ⌘S 저장        ⇧⌘S 다른 이름으로
⌘W 탭 닫기      ⌃Tab 탭 순환    ⌘1..9 탭 점프
⌘K AI 인라인 편집  ⌘L 채팅 포커스   ⌘P 팔레트      ⌘F 찾기
⌘J 채팅 패널     ⌥⌘B 사이드바    ⌘/ 단축키 도움말
```

## 구조

```
docpilot/
  packages/shared/   프론트 ↔ 사이드카 공유 타입 (단일 진실 원천)
  sidecar/           Node 에이전트 서버. codex app-server 래핑, 127.0.0.1 SSE
  app/
    src/             React 프론트
      agent/         사이드카 HTTP/SSE 클라이언트 (AbortSignal 지원)
      editor/        EditorAdapter(추상) + Tiptap(md) / docx-editor(docx) 어댑터
      inline-edit/   선택→⌘K→지시→스트림→diff→수락/거절 (제품의 심장)
      chat/          오른쪽 날개 채팅 (Ask / 에이전틱 Edit)
      documents/     멀티탭 문서 스토어, 파일 열기·저장, 문서↔threadId 매핑
      ui/            탭바·웰컴·커맨드 팔레트·찾기·상태바·단축키 도움말
      state/         레이아웃·선택·세션·테마·UI 스토어 (zustand)
    src-tauri/       Rust 셸: 사이드카 생명주기 + 파일 IO + 네이티브 메뉴 + threadId 저장
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

1. 웰컴 화면에서 **New** 또는 **Open…** (창에 파일을 드래그해도 열린다). 탭으로 여러 문서를 동시에.
2. 문장/문단을 드래그하고 **⌘K** — 지시를 입력하거나 빠른 칩(간결하게·맞춤법 등)을 누른다.
3. AI가 선택 부분만 새로 써서 diff로 보여준다 → **⏎ 수락** / **Esc 거절**.
4. 문서 전체를 고치려면 오른쪽 채팅 **Edit** 모드 — Codex가 파일을 직접 편집하고, 변경 diff와 Revert 버튼이 남는다.
5. **⌘S** 저장. 문서에 묶인 codex thread id가 저장돼, 다시 열면 같은 세션을 resume하고 프롬프트 캐시가 살아있다.

## 동작 원리 한 줄

- 문서당 codex thread 1개 → `~/.codex/sessions`에 영속 + `app_data/threads.json`에 매핑
- 같은 thread를 계속 `run()` → 프롬프트 캐시 히트(검증: 2nd edit `cachedInputTokens` 0→1만+)
- context 길어지면 Codex가 자동 컴팩팅 — 우리가 손대지 않음
- AI 출력은 항상 "교체본만". 전체 재작성 금지. 수락 전엔 문서 불변, 수락은 트랜잭션 1건이라 ⌘Z로 되돌림
- Stop/창 닫기 → SSE 연결 종료 → 사이드카가 감지해 `turn/interrupt` — 토큰 낭비 없음
