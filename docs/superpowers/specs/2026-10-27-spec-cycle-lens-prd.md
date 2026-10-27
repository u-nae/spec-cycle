# spec-cycle-lens — 작업계획서 (PRD)

- 작성일: 2026-10-27
- 상태: v0.2 확정 (2026-10-27, 열린 질문 Q1~Q6 결정 반영)
- mod 저장소: https://github.com/u-nae/spec-cycle-lens.git
- 대상: `spec-cycle` 0.3.0 → 0.4.0 변경 + 신규 Claude Code mod `spec-cycle-lens`(가칭)
- 구현 환경: 로컬 Claude Code 2.1.287 이상 (mod API 기준 확인 버전 2.1.311)

---

## 1. 배경과 목적

`spec-cycle`은 작업 항목이 독립 비평을 통과한 명세를 가진 뒤에만 구현에 들어가게 하는 게이트다. 의도적으로
**사람만 호출**하고(`disable-model-invocation: true`), **판정과 상태 전이는 스크립트만** 수행하며, **hook 자동화가
없다.** 그 결과 지금은 "어떤 작업 항목이 어디까지 왔고 다음에 무엇을 쳐야 하는지"를 보려면 `status` 출력이나
run 디렉터리를 직접 열어야 한다.

`spec-cycle-lens`는 이 공백을 메우는 **관측·안내 레이어**다. 게이트의 성질을 하나도 바꾸지 않고 다음 세 가지만 한다.

1. 현재 작업 항목의 단계·판정·revision·커버리지를 프롬프트 위 band에 한 줄로 보여 준다.
2. 작업 항목, run 이력, 미응답 질문(권장안 포함), 산출물을 pane에서 탐색하게 한다.
3. 다음에 칠 커맨드(`/spec-cycle:run W05` 등)를 프롬프트에 **제안만** 한다. 전송하지 않는다.

## 2. 원칙 (불변식)

이 문서의 모든 결정은 아래를 깨지 않는 범위에서만 유효하다.

| ID | 원칙 |
| --- | --- |
| P1 | mod는 spec-cycle의 어떤 상태도 바꾸지 않는다. 승인, 판정, `set-status`, 파일 쓰기를 하지 않는다 |
| P2 | mod는 턴을 시작하지 않는다. `$.prompt.submit`, `$.session.send`, `$.model.*`을 쓰지 않는다 |
| P3 | 상태의 단일 출처는 `spec-cycle.mjs`다. mod는 판정 로직(fingerprint, 최신 run 선택, 커버리지)을 재구현하지 않는다 |
| P4 | mod가 없어도 spec-cycle은 그대로 동작한다. spec-cycle은 mod를 모른다 |
| P5 | MVP의 `$` 호출 범위는 `fs.read/stat/exists`, `clock.*`, `ui.*`, `prompt.suggest`, `store.*`, `state.*`, `command.register`로 제한한다. `process.*`는 선택 기능(P2 단계)에서만, 사용자가 켰을 때만 쓴다 |

## 3. 범위

### 포함

- **spec-cycle 0.4.0:** 기계용 상태 스냅숏(`status --json`, `.spec-cycle/status.json`)
- **mod MVP:** band, pane(작업 항목·run 탭), 다음 커맨드 제안, `/lens` 커맨드
- **mod 2단계:** 산출물 탭(문서 읽기·에디터 열기), 판정 전이 toast, 수동 새로고침(선택적 process)
- **mod 3단계(선택):** 게이트 밖 편집 경고 가드. 기본값 꺼짐

### 제외 (Non-goals)

- 게이트를 대체하거나 단축하는 모든 기능(원클릭 승인, 자동 run 등)
- NEEDS_HUMAN 질문에 mod가 답하는 기능. 답은 run 커맨드 안의 `AskUserQuestion`으로만 받는다
- Task Master, Linear 등 외부 트래커와의 동기화
- spec-cycle 판정 로직의 변경

## 4. 아키텍처

```text
 spec-cycle.mjs (단일 작성자)                         spec-cycle-lens (읽기 전용)
 ─────────────────────────────                        ─────────────────────────────
 resolve-inputs / validate-* / build-handoff  ──┐
 set-status / verify-obligations / render-brief ─┼─▶ .spec-cycle/status.json ──▶ $.fs.read (mtime 캐시)
 status --json --write (수동)                 ──┘        (schema 1.0)               │
                                                                                     ├─ band (AbovePrompt)
 run 디렉터리의 산출물 (*.yaml, *.feature, *.md) ──────────────────────────────────▶ ├─ pane (Items / Run / Docs)
                                                                                     ├─ prompt.suggest / PromptHint
                                                                                     └─ toast (판정 전이)
```

**선택한 방식: 스크립트가 쓰는 스냅숏 파일을 mod가 읽는다(pull).**

검토한 대안과 기각 이유는 다음과 같다.

| 대안 | 기각 이유 |
| --- | --- |
| mod가 run 디렉터리를 직접 해석 | P3 위반. `latestRunFor`, fingerprint 무효화, 커버리지 계산을 TS로 중복 구현해야 하고 둘이 어긋날 수 있다 |
| mod가 매번 `node spec-cycle.mjs status --json` 실행 | 다른 플러그인의 설치 경로를 알아야 하고, 샌드박스 밖 full-permission 프로세스가 MVP에 들어온다(P5). 2단계 선택 기능으로만 둔다 |
| feature-progress식 report 툴(push) | 모델이 호출해야 갱신되므로 누락과 토큰 비용이 생긴다. spec-cycle은 이미 결정론적 스크립트가 있다 |

## 5. spec-cycle 0.4.0 변경

### 5.1 `status --json`

기존 `status`(YAML 표)는 유지하고 `--json`을 추가한다. `--write`가 있으면 결과를 `.spec-cycle/status.json`에
원자적으로 쓴다(임시 파일 → rename).

### 5.2 자동 스냅숏 갱신

아래 서브커맨드가 성공적으로 끝날 때 마지막 단계로 스냅숏을 다시 쓴다. 실패해도 원래 커맨드의 종료 코드는 바꾸지 않고
stderr에 경고 한 줄만 남긴다.

`init`, `import-taskmaster`, `resolve-inputs`, `normalize`, `validate-author`, `validate-critic`,
`validate-decisions`, `build-handoff`, `render-brief`, `set-status`, `verify-obligations`

읽기 전용 서브커맨드(`detect`, `resolve-handoff`, `fingerprint`, `check-decision`, `decision-vectors`, `check-plan`,
`status`(플래그 없이), `validate-fixtures`, `metrics`)는 스냅숏을 쓰지 않는다. `validate-*`는 파일을 쓰지 않지만
run 단계가 넘어가는 시점이라 갱신 대상에 넣는다.

### 5.3 스키마 `status.json` (schema 1.0)

```jsonc
{
  "schema_version": "1.0",
  "generated_at": "2026-10-27T06:00:00.000Z",
  "generated_by": "spec-cycle@0.4.0 build-handoff",   // 어떤 커맨드가 썼는지
  "config": {
    "path": ".spec-cycle/config.yaml",
    "intake": "native",
    "execution": "superpowers",
    "run_root": ".spec-cycle/runs",
    "work_items": "docs/work-items.yaml"
  },
  "inputs": [                                           // mod의 저비용 신선도 확인용
    { "path": "docs/PRD.md", "mtime_ms": 1791953472870 },
    { "path": "docs/work-items.yaml", "mtime_ms": 1791953472871 },
    { "path": "docs/decisions", "mtime_ms": 1791953472872, "kind": "dir-max" }
  ],
  "items": [
    {
      "id": "W05",
      "parent_id": null,
      "title": "Record a revision for every confirmed configuration change",
      "status": "pending",                              // pending | in-progress | done | deferred
      "priority": "high",
      "dependencies": ["W04"],
      "dependencies_done": true,
      "external_ref": null,
      "run": {                                          // 최신 run, 없으면 null
        "id": "t-w05-c0dec005",
        "dir": ".spec-cycle/runs/t-w05-c0dec005",
        "updated_at": "2026-10-27T05:58:00.000Z",
        "revision_count": 1,
        "max_revisions": 2,
        "critic_passes": 2,
        "verdict": "NEEDS_HUMAN",                       // null(비평 전) | READY | REVISE | NEEDS_HUMAN | BLOCKED_AT_LIMIT
        "findings": { "critical": 0, "major": 1, "minor": 2, "note": 0 },
        "open_questions": [
          {
            "question_id": "Q-W05-1",
            "question": "…",
            "blocking": true,
            "recommended_default": "A",
            "recommended_label": "…"
          }
        ],
        "route": "GHERKIN",
        "artifacts": {                                  // 존재하는 것만, 저장소 상대 경로
          "handoff": ".spec-cycle/runs/…/tdd-handoff.yaml",
          "brief": null,
          "verification": null,
          "decision_log": ".spec-cycle/runs/…/decision-log.yaml",
          "critic_reports": [".spec-cycle/runs/…/critic-pass-1.yaml", "…critic-pass-2.yaml"],
          "spec_files": [".spec-cycle/runs/…/specs/revision-1/task-W05.feature"]
        }
      },
      "handoff": {                                      // READY handoff가 있을 때만
        "usable": true,                                 // resolveHandoff().usable
        "errors": [],                                   // 예: "baseline docs/PRD.md changed since the handoff; rerun the gate"
        "warnings": [],
        "obligations_total": 7
      },
      "verification": {                                 // verification.yaml이 있을 때만
        "covered": 5,
        "total": 7,
        "checked_at": "…",
        "tests": "passed",                              // passed | failed | confirmed | unknown
        "status_written": null
      }
    }
  ]
}
```

규칙:

- `items`는 `docs/work-items.yaml`의 순서를 따르고, 하위 항목(`W05.1`)은 부모 바로 뒤에 둔다.
- `handoff.usable`, `handoff.errors`, `handoff.warnings`는 `resolveHandoff()` 결과를 그대로 쓴다(P3).
- 질문 본문은 `questions.yaml` 또는 최신 critic report 중 미응답(`answer: null`) 항목만 넣는다.
- 경로는 모두 저장소 상대 경로, 시간은 ISO-8601 UTC.

### 5.4 부수 변경

- `references/contracts.md`에 "Status snapshot" 절 추가
- `resolve-inputs`의 `gitignore_hint`와 README 권장 `.gitignore`에 `.spec-cycle/status.json` 추가
- `plugin.json` 버전 0.4.0, `docs/validation-results.md` 갱신

### 5.5 수용 기준 (spec-cycle)

| ID | 기준 |
| --- | --- |
| A01 | `status --json`은 위 스키마를 만족하는 JSON을 stdout에 쓰고, 기존 `status`(YAML) 출력은 바이트 단위로 변하지 않는다 |
| A02 | `--write`는 `.spec-cycle/status.json`을 원자적으로 쓴다. 쓰기 도중 읽어도 부분 JSON이 보이지 않는다 |
| A03 | 5.2의 서브커맨드가 성공하면 스냅숏이 갱신되고, `generated_by`에 그 커맨드 이름이 남는다 |
| A04 | 스냅숏 쓰기 실패는 원래 커맨드의 종료 코드와 stdout을 바꾸지 않는다 |
| A05 | 입력이 바뀌어 handoff가 무효가 되면 다음 스냅숏에서 `handoff.usable: false`와 `errors`가 `resolve-handoff` 출력과 같다 |
| A06 | NEEDS_HUMAN run의 미응답 질문만 `open_questions`에 들어가고, 답한 질문은 빠진다 |
| A07 | 기존 테스트 전체와 `validate:fixtures`가 통과한다. 새 테스트는 fixture 7종(both, dmn, gherkin, needs-human, pass, revise, taskmaster)에 대한 스냅숏 골든을 포함한다 |

## 6. spec-cycle-lens (mod)

### 6.1 활성 작업 항목 선택

band와 제안은 "활성 항목" 하나를 기준으로 한다. 순수 함수 `pickActive(snapshot, pinned)`로 정한다.

1. `/lens pin W05`로 고정한 항목이 있으면 그것(`$.store`에 프로젝트 루트별 저장)
2. 없으면 `in-progress` 항목 중 run이 가장 최근인 것
3. 없으면 run이 있고 `done`이 아닌 항목 중 `run.updated_at`이 가장 최근인 것
4. 없으면 의존성이 모두 `done`인 `pending` 항목 중 work-items 순서상 첫 번째
5. 모두 없으면 활성 항목 없음

### 6.2 다음 커맨드 표 (`nextCommand`)

순수 함수, 표 그대로 테스트한다.

| 조건 | 제안 | band 표시 |
| --- | --- | --- |
| `status.json`도 `config.yaml`도 없음 | `/spec-cycle:init` | 표시 안 함 |
| `config.yaml`은 있고 스냅숏 없음 | 없음 | `spec-cycle: 스냅숏 없음 · /lens refresh` |
| 작업 항목 0개 | `/spec-cycle:work-items` | `작업 항목 없음` |
| 활성 항목 `pending`, run 없음 | `/spec-cycle:run W` | `대기` |
| run 진행 중(`verdict: null`) | 없음 | `작성/비평 중` |
| `REVISE` | 없음 (run 커맨드가 루프를 이어감) | `REVISE r1/2` |
| `NEEDS_HUMAN` | `/spec-cycle:run W` | `질문 N개` |
| `BLOCKED_AT_LIMIT` | 없음 | `한도 도달` 경고색 |
| `READY`, `handoff.usable`, 상태 `pending` | `/spec-cycle:implement W` | `READY` |
| `READY`인데 `handoff.usable: false` | `/spec-cycle:run W` | `입력 변경됨` 경고색 |
| `in-progress`, 검증 없음 또는 미커버 있음 | `/spec-cycle:verify W` | `구현 중 · cov x/y` |
| `done` | 다음 후보가 있으면 `/spec-cycle:run Wn` | `완료` |

`REVISE`에서 제안이 없는 이유: revision 루프는 같은 run 커맨드 안에서 스크립트가 돈다. 사람이 끼어들 지점이 아니다.

### 6.3 Band (AbovePrompt)

```text
◆ W05 Record a revision…   NEEDS_HUMAN · 질문 1   r1/2   ━━━━━─── 3/8 done
```

- 구성: 상태 글리프, 항목 id, 제목, 단계 칩(반전색), revision, 전체 진행 미터(`done/total`), 커버리지(구현 중일 때)
- 폭 대응: 고정 폭(글리프+칩+카운트)을 먼저 확보하고, 미터는 남은 폭이 12칸 이상일 때만, 제목은 나머지 폭에 맞춰 자른다
  (feature-progress `band.tsx` 방식). 단계 칩과 id는 마지막까지 남긴다(astrolabe의 shed 순서 참고)
- `e.props.hasSurvey`면 그리지 않는다. 항상 `next(e)` 결과 위에 쌓는다
- band 전체가 하나의 `Button plain`이고, 누르면 pane을 연다
- 신선도: `inputs[].mtime_ms`보다 실제 파일 mtime이 새로우면 끝에 `⚠ 스냅숏 오래됨`을 붙인다(해시 계산 없이 `$.fs.stat`만)
- `userConfig.band`가 `off`면 그리지 않는다

### 6.4 Pane (`/lens`)

탭은 `Button hotkey`로 전환한다(1/2/3). 원시 키 핸들러는 쓰지 않는다.

1. **Items:** 작업 항목 카드 목록. 카드마다 상태 칩, 판정, revision, 커버리지, 의존성 미충족 표시. Enter로 해당 항목을 Run 탭에서 연다. `p`로 pin/unpin
2. **Run:** 선택한 항목의 최신 run. critic pass별 판정과 발견 수, 미응답 질문(질문, 권장안, 근거 한 줄), decision log, handoff의 `errors`/`warnings`
3. **Docs** (2단계): run 산출물 목록. Enter로 pane 안에서 읽기(`Markdown`, `.feature`/`.yaml`은 `Code`), `o`로 에디터 열기, `b`로 돌아가기

반응형: 44칸 미만에서는 카드 테두리를 없애고, 64칸 미만에서는 세부 정보를 둘째 줄로 내린다.

### 6.5 다음 커맨드 제안

- `session.start`(첫 읽기 후)와 `turn.complete`(`!e.agentId`)에서 `$.prompt.suggest({ text })`를 호출한다
- 같은 텍스트는 다시 제안하지 않는다(`lastSuggested`를 `$.state`에 보관)
- 프롬프트에 초안이 있을 때(`isDraft`)는 `PromptHint`의 `tail`에 붙인다. 커맨드는 한 곳에만 나온다
- `$.prompt.fill`과 `$.prompt.submit`은 쓰지 않는다(P2)
- `userConfig.suggest`가 `off`면 둘 다 하지 않는다

### 6.6 갱신 트리거

| 트리거 | 동작 |
| --- | --- |
| `session.start` | 스냅숏 읽기, 커맨드 등록, 타이머 시작 |
| `classic.SessionStart` `{source: clear/resume/fork}` | 다시 읽기(`/clear` 뒤에는 `session.start`가 오지 않음) |
| `tool.call` (Bash/Edit/Write) `next()` 이후 | `status.json` mtime만 확인해 바뀌었으면 다시 읽기 |
| `turn.complete` (메인 스레드) | 최종 읽기, 판정 전이 toast, 제안 갱신 |
| 턴 진행 중 2초 타이머 | mtime 확인만. 턴이 끝나면 정지 |
| 60초 타이머 | 파일을 읽지 않고 상대 시간과 신선도 표시만 다시 그림 |

- 읽기는 `mtimeMs:size` 키로 캐시한다. 렌더 시그니처가 바뀔 때만 `$.ui.invalidate`를 부른다
- 스냅숏 JSON 파싱에 실패하면 이전 상태를 유지하고 band 끝에 `⚠`만 표시한다

### 6.7 Toast (2단계)

이전 판정을 `$.state`에 기억해 두고, 전이가 생길 때 한 번만 알린다. 세션의 첫 읽기는 기준선만 기록한다.

- `→ READY`: `W05 READY · /spec-cycle:implement W05`
- `→ NEEDS_HUMAN`: `W05 질문 1개 · 권장안 A`
- `→ BLOCKED_AT_LIMIT`: `W05 revision 한도 도달`
- `→ done`: `W05 완료 · 다음 W06`

### 6.8 에디터 열기 (2단계)

전용 API가 없으므로 다음 순서로 시도한다.

1. 창형 `$VISUAL`/`$EDITOR`(vim 계열 터미널 에디터는 제외, `--wait` 제거)
2. `TERM_PROGRAM` 기준 `code`/`cursor`
3. `open`(macOS)

각 시도는 `$.process.run(argv, { timeoutMs: 10000 })`이다. 모두 실패하면 `$.ui.copy`로 경로를 복사하고 toast를 띄운다.
이 기능을 켜면 `process.*`가 들어오므로 `userConfig.openInEditor` 기본값은 `off`다. 꺼져 있을 때는 `file://` 링크와
경로 복사만 제공한다.

> 개인 환경 메모: 주 에디터가 Neovim이면 1번 경로는 의도적으로 제외된다. tmux 새 창에서 `nvim <path>`를 여는
> 옵션(`openInEditor: tmux-nvim`)을 3단계 후보로 둔다.

### 6.9 수동 새로고침 (2단계, 선택)

`/lens refresh`는 `userConfig.specCycleScript`(예: `~/Documents/u.naee/spec-cycle/scripts/spec-cycle.mjs`)가 설정되어
있을 때만 `node <script> status --json --write`를 실행한다. 미설정이면 설정 방법을 텍스트로 답한다.

### 6.10 가드 (3단계, 선택, 기본 꺼짐)

`userConfig.guard: off | warn | ask`.

- `warn`: 활성 항목이 `in-progress`가 아닐 때 `test_globs` 밖 소스 파일에 대한 Edit/Write가 일어나면 toast 경고만 한다(결정에 관여하지 않음)
- `ask`: 같은 조건에서 `tool.check`를 `ask`로 올린다. `.catch`로 실패 시 `next(e)`(fail-open)를 명시한다
- 이 기능은 spec-cycle의 "hook 자동화 없음" 원칙과 긴장 관계에 있으므로, 켜기 전에 결정 기록으로 남긴다

### 6.11 설정 (`userConfig`)

| 키 | 값 | 기본 | 단계 |
| --- | --- | --- | --- |
| `band` | `on`, `off` | `on` | 1 |
| `suggest` | `on`, `off` | `on` | 1 |
| `icons` | `unicode`, `nerd`, `emoji` | `unicode` | 1 |
| `snapshotPath` | 문자열 | `.spec-cycle/status.json` | 1 |
| `toasts` | `on`, `off` | `on` | 2 |
| `openInEditor` | `off`, `auto`, `tmux-nvim` | `off` | 2/3 |
| `specCycleScript` | 경로 | 빈 값 | 2 |
| `guard` | `off`, `warn`, `ask` | `off` | 3 |

### 6.12 수용 기준 (mod)

| ID | 기준 |
| --- | --- |
| A11 | 스냅숏이 없는 프로젝트에서 mod는 band를 그리지 않고, 오류 toast도 띄우지 않는다 |
| A12 | 6.2 표의 각 행에 대해 `nextCommand`가 해당 제안과 band 문구를 돌려준다(표 주도 단위 테스트) |
| A13 | 6.1의 선택 규칙 1~5가 각각 단위 테스트로 증명된다 |
| A14 | band는 `bodyColumns` 40/60/80/120에서 한 줄을 넘지 않고, 항목 id와 단계 칩은 40칸에서도 남는다 |
| A15 | 같은 다음 커맨드는 세션 안에서 한 번만 `prompt.suggest`된다. `prompt.submit`/`prompt.fill` 호출은 0회다 |
| A16 | `status.json`이 바뀐 뒤 다음 `tool.call` 또는 `turn.complete`에서 band가 갱신된다. 바뀌지 않았으면 파일을 다시 파싱하지 않는다 |
| A17 | 깨진 JSON을 읽으면 이전 상태를 유지하고 `⚠`를 표시한다 |
| A18 | `/clear` 뒤에도 band가 복구된다 |
| A19 | `claude plugin validate --strict`의 `calls` 목록이 MVP에서 P5 범위를 벗어나지 않고, `gatingHooks`가 비어 있다 |
| A20 | pane은 터미널과 데스크톱 surface에서 mount 테스트를 통과한다 |

## 7. 구현 구조 (mod)

```text
spec-cycle-lens/
  .claude-plugin/plugin.json      # name, version, userConfig
  hooks/hooks.json                # { "modules": ["./register.tsx"] }
  hooks/register.tsx              # 배선만. $를 Host 객체로 한 번 묶음 (diff mod 방식)
  hooks/host.ts                   # $ 호출 래퍼 (fs, clock, ui, prompt, store)
  hooks/snapshot.ts               # 읽기 + mtime 캐시 + 스키마 검증 (순수, Fs 포트 주입)
  hooks/active.ts                 # pickActive (순수)
  hooks/next-command.ts           # nextCommand (순수, 표)
  hooks/band.tsx                  # band 렌더 + 폭 계산
  hooks/pane.tsx                  # 탭, 카드
  hooks/icons.ts                  # 글리프 세트와 열 폭
  types/index.d.ts                # PluginState 계약
  tests/*.test.ts(x)              # 모듈당 하나, claude-code/testing
  tsconfig.json
```

규칙:

- `$.noun.method`를 항상 풀어서 쓴다. `$`를 구조분해하거나 별칭으로 두지 않는다(정적 분석 요구사항)
- 모든 hook에 `.catch(($, e, next) => next(e))`를 단다
- 이름은 `claude-`로 시작할 수 없다

## 8. 단계별 계획

| 단계 | 산출물 | 완료 조건 |
| --- | --- | --- |
| 0. 스파이크 (반나절) | 빈 mod로 band 한 줄, `prompt.suggest`, `/lens` pane 열기 확인 | 로컬 Claude Code에서 눈으로 확인, `validate` 통과 |
| 1. spec-cycle 0.4.0 | `status --json/--write`, 자동 스냅숏, contracts 절, 테스트 | A01~A07 |
| 2. mod MVP | snapshot/active/next-command/band/pane(Items, Run)/suggest | A11~A20 |
| 3. mod 확장 | Docs 탭, toast, 에디터 열기, 수동 새로고침 | 해당 기능 테스트, 실제 프로젝트 1곳에서 일주일 사용 |
| 4. 선택 | 가드, `tmux-nvim`, prismantis 연동 | 결정 기록 후 착수 |

**도그푸딩:** 이 PRD를 baseline으로 `spec-cycle-lens` 저장소에 `/spec-cycle:init`을 실행하고,
1·2단계를 작업 항목으로 나눠 spec-cycle로 진행한다. 수용 기준 ID(A01~A20)는 그대로 `acceptance_refs`로 쓴다.

## 9. 레퍼런스

| 레포 | 가져올 것 | 가져오지 않을 것 |
| --- | --- | --- |
| anthropics/claude-code `mods/diff` | `Host` 바인딩, 폴링·redraw 병합, 테스트 구조(`tier`, 파일당 테스트) | — |
| dougcunha/claude-mods `feature-progress` | band 폭 계산(`band.tsx`), 카드 반응형(`pane.tsx` 44/64칸), `icons.ts`, stale 판정, mount 기반 band 테스트 | report 툴, JSON 쓰기, `clean` |
| alfredoperez/speckit-companion-claude-mod | mtime 캐시와 시그니처 비교 후 invalidate, Button hotkey 탭, 문서 읽기·`b` 복귀, `$.ui.focus` 복원, 에디터 후보 순서, `ensureStarted` | 742줄 단일 파일, 수작업 `h()` 트리, 테스트 부재 |
| jonyfs/astrolabe | `prompt.suggest` 중복 방지(`register.tsx` 2492~2508), `PromptHint` tail(`core/hint.ts`), 순수 `nextCommand` 표, shed 순서, `Fs` 포트와 fake-fs 테스트 | `prompt.submit`, 사용량 거버너, system prompt 주입, 대형 register 파일 |
| NahumLitvin/prismantis (선택) | `$.prismantis.markdown`으로 Docs 탭 렌더, 미설치 시 `Markdown`으로 대체 | — |

공식 문서: code.claude.com/docs/en/plugins/mods (create, overview, interface)

## 10. 확정된 결정

2026-10-27에 열린 질문 Q1~Q6을 모두 권장안대로 확정했다. 구현 세션은 이 결정을 전제로 한다.

| ID | 질문 | 결정 | 근거 |
| --- | --- | --- | --- |
| Q1 | mod 이름과 커맨드 | `spec-cycle-lens`, 커맨드 `/lens` | 대상이 분명하고 커맨드는 짧게 둔다 |
| Q2 | mod 저장소 위치 | 별도 저장소 `u-nae/spec-cycle-lens` (원격 생성 완료) | P4(spec-cycle은 mod를 모른다)와 최소 버전 차이(2.1.231 vs 2.1.287)를 지키기 쉽다 |
| Q3 | 스냅숏 자동 갱신 범위 | 5.2의 상태 변경 서브커맨드 전부 | run 중간(REVISE, NEEDS_HUMAN) 상태가 band에 보여야 한다 |
| Q4 | `status.json`의 git 추적 | 무시(`.gitignore`) | 로컬 파생물이고 mtime 값이 기기마다 다르다 |
| Q5 | 가드(6.10) 도입 | 3단계에서 `warn`만 검토, 착수 전 결정 기록 작성 | spec-cycle의 "hook 자동화 없음" 원칙과 충돌 소지 |
| Q6 | 구현 언어 | TypeScript(TSX) | 엔진이 mod 타입을 생성하고 테스트 키트도 TS 기준 |

이 결정들은 spec-cycle-lens 저장소의 결정 기록(`docs/decisions/0001~0006`)으로 옮겨 baseline과 함께 fingerprint에 포함한다.

## 11. 위험

| 위험 | 대응 |
| --- | --- |
| mod API가 early access라 버전 간 변경 가능 | 확인 버전(2.1.311)을 README에 명시, `validate`를 CI 대신 로컬 스크립트로 묶어 업데이트 후 바로 확인 |
| 스냅숏과 실제 상태의 불일치 | 스크립트만 쓰고 mod는 읽기만. mtime 기반 `⚠ 스냅숏 오래됨` 표시, 수동 새로고침 제공 |
| band가 다른 mod(prismantis 등)와 겹침 | 항상 `next(e)` 위에 쌓고 `hasSurvey`를 존중 |
| 사람 호출 원칙의 약화 | P1·P2를 수용 기준(A15, A19)으로 테스트 |
