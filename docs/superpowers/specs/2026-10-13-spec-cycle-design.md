# spec-cycle 설계 명세

- 날짜: 2026-10-13
- 상태: 사용자 검토 대기
- 선행: `fianchetto-spec-gate` 0.1.1 (최신 코어), `stemus/ps/specification-gate` 0.1.0 (원본)

## 1. 목적

`spec-cycle`은 기준 문서에서 뽑은 작업 항목이 **독립 비평을 통과한 명세**를 갖춘 뒤에만 구현에 들어가고,
구현이 끝나면 **그 명세의 test obligation이 실제 테스트로 덮였는지 확인**하는 Claude Code 플러그인이다.

기존 `fianchetto-spec-gate`의 코어(입력 해석 → 작성 → 독립 비평 → 판정 루프 → READY 전용 handoff → 결정
기록 승격)를 그대로 유지하고, 앞단과 뒷단을 **설정으로 고르는 어댑터**로 바꿔 개인 프로젝트와 회사
프로젝트에서 플러그인 파일을 고치지 않고 재사용한다.

```text
[Intake]                    [Core gate — 유지]                          [Execution]
 native   work-items 스킬     resolve-inputs → author → critic(독립)       superpowers  writing-plans → SDD / executing-plans
 taskmaster tasks.json 수입   → 판정 루프(revision ≤ 2) → tdd-handoff       inline       handoff 요약 + 세션 내 TDD
     ↓ work-items.yaml        → 결정 기록 승격                              command      설정된 커맨드(예: /task-cycle 6)
                                                   ↓ tdd-handoff.yaml + spec-brief.md
                               [Close the loop]  verify-obligations → 통과 시에만 작업 항목 done
```

### 1.1 해결하는 문제

| 문제 | 현재(fianchetto-spec-gate) | spec-cycle |
| --- | --- | --- |
| 프로젝트마다 플러그인을 복제·수정 | 이름·경로·입력 형식이 플러그인 파일에 박힘 | `.spec-cycle/config.yaml`의 `intake`/`execution` 어댑터 선택 |
| Task Master 기반 팀 흐름에 못 붙음 | Task Master 입력을 제거함 | `taskmaster` intake 어댑터가 `tasks.json`을 `work-items.yaml` 초안으로 수입 |
| handoff 이후가 비어 있음 | "TDD 시작은 사람이" 에서 끝 | `implement`가 superpowers `writing-plans`에 brief를 넘기고, plan이 모든 obligation을 배정했는지 검사 |
| obligation 커버리지를 아무도 확인하지 않음 | 없음 | `verify`가 테스트 파일에서 `obligation_id`를 찾아 미커버를 보고. 통과 시에만 `done` |
| 결정표(DMN)가 미완성 | `review-only`. gap/overlap은 작성자의 산문 주장 | `table-v1`: 스크립트가 셀을 열거해 gap/overlap을 **계산**, 규칙 단위 obligation과 테스트 벡터 생성 |

### 1.2 범위 밖

- hook 자동화(PreToolUse 등). 모든 진입점은 사람이 호출한다.
- 외부 DMN/FEEL 엔진, DMN 1.3 XML 내보내기.
- Task Master `tasks.json`으로의 상태 write-back (v1은 단방향 수입).
- GitHub Issues 등 다른 intake. 어댑터 슬롯만 남긴다.
- `fianchetto`, `stemus` 프로젝트 저장소 수정. 마이그레이션은 §12에 절차만 적는다.
- superpowers 스킬 복제. 이름으로 호출하고 미설치면 `inline`으로 내려간다.

## 2. 지키는 성질

fianchetto-spec-gate의 네 성질을 그대로 유지하고 하나를 더한다.

| 성질 | 유지 수단 |
| --- | --- |
| 모델이 게이트를 임의로 건너뛰거나 발동하지 않음 | 모든 스킬 `disable-model-invocation: true`, 커맨드는 사람이 호출 |
| 작성자가 자기 결과를 승인하지 못함 | critic은 항상 별도 컨텍스트(`context: fork` 스킬 또는 서브에이전트) |
| 비평 종료 시점이 모델 재량이 아님 | `validate-critic`이 판정 규칙을, `max_revisions: 2`가 횟수를 강제 |
| 미준비 산출물이 구현으로 새지 않음 | `build-handoff`·`resolve-handoff`가 READY 아닌 run을 거부 |
| **작업 항목 상태는 사이클이 증명한 만큼만 바뀜** (신규) | 상태 전이는 `implement`(→ `in-progress`)와 `verify`(→ `done`) 두 곳에서만, 스크립트 `set-status`로만 일어난다. `verify`는 커버리지가 완전할 때만 `done`을 쓴다 |

## 3. 플러그인 구조

```text
spec-cycle/
├── .claude-plugin/plugin.json          name: spec-cycle
├── .claude-plugin/marketplace.json     개인 marketplace
├── commands/
│   ├── init.md        환경 감지 → config 생성 (기존 .spec-gate/config.yaml 채택 지원)
│   ├── run.md         게이트 1회 실행 (fianchetto-spec-gate run.md 계승)
│   ├── implement.md   READY handoff → brief → execution 어댑터
│   └── verify.md      obligation 커버리지 검사 → done
├── skills/
│   ├── work-items/              intake.adapter에 따라 native 도출 또는 taskmaster 수입 + 보강
│   ├── specification-author/    유지 (table-v1 작성 규칙 추가)
│   └── specification-critic/    유지 (check-decision 결과를 근거로 삼는 규칙 추가)
├── agents/specification-critic-agent.md   유지
├── references/
│   ├── contracts.md             계약 1.1 (§5)
│   ├── critic-policy.md         유지 + 결정표 검사 규칙
│   ├── routing-and-formats.md   유지 + table-v1 문법
│   └── adapters.md              intake/execution 어댑터 계약 (신규)
├── scripts/
│   ├── spec-cycle.mjs           CLI 진입점. 서브커맨드 분기만 담당
│   └── lib/
│       ├── core.mjs             기존 spec-gate.mjs의 resolve/normalize/validate/handoff (이동, 동작 불변)
│       ├── decision.mjs         table-v1 평가기: check-decision, decision-vectors (신규)
│       ├── intake-taskmaster.mjs  import-taskmaster (신규)
│       ├── brief.mjs            render-brief, check-plan (신규)
│       ├── verify.mjs           verify-obligations, set-status, status (신규)
│       └── detect.mjs           init용 환경 감지 (신규)
├── fixtures/cases/{pass,gherkin,dmn,both,needs-human,revise,taskmaster}/
├── fixtures/dry-run/
├── tests/*.test.mjs             모듈별 테스트
├── docs/{integration.md,validation-results.md}
├── node_modules/                yaml, @cucumber/gherkin 동봉 (플러그인 설치는 npm install을 하지 않음)
└── package.json
```

`core.mjs`는 `fianchetto-spec-gate/scripts/spec-gate.mjs`를 옮긴 것이다. 함수 분리 외의 동작 변경은 §5·§9에
적은 것만 허용한다. 기존 테스트 43개는 그대로 통과해야 한다.

사용자 대면 문서(커맨드, README, docs)는 한국어, 스킬·계약·에이전트는 영어로 쓴다. 현행과 같다.

## 4. 설정 — `.spec-cycle/config.yaml`

```yaml
schema_version: "1.1"
baseline:
  - docs/PRD.md
  - docs/TECH_STACK.md
decision_records: docs/decisions        # 또는 null
work_items: docs/work-items.yaml
run_root: .spec-cycle/runs

intake:
  adapter: native                        # native | taskmaster
  taskmaster:                            # adapter: taskmaster 일 때만
    tasks: .taskmaster/tasks/tasks.json
    tag: null                            # null 이면 .taskmaster/state.json 의 currentTag, 없으면 master

execution:
  adapter: superpowers                   # superpowers | inline | command
  command: null                          # adapter: command 일 때 "/task-cycle" 처럼 슬래시 커맨드
  plan_dir: docs/superpowers/plans       # superpowers 가 plan 을 두는 위치 (check-plan 이 읽음)

verification:
  test_globs: ["FianchettoTests/**/*.swift"]   # obligation_id 를 찾을 파일
  id_pattern: null                       # null 이면 obligation_id 리터럴 매칭. 정규식 문자열이면 {id} 자리에 치환
  test_command: null                     # 선택. 설정되면 verify 가 실행해 결과를 보고
```

**호환**: `schema_version: "1.0"` 파일은 `intake.adapter: native`, `execution.adapter: inline`,
`verification.test_globs: []`로 읽힌다. 1.0 config로 `verify`를 부르면 `test_globs`가 비었다는 오류로 안내한다.
`init --adopt <path>`는 기존 `.spec-gate/config.yaml` 값을 복사해 `.spec-cycle/config.yaml`을 만들고
`run_root`는 원래 값(`.spec-gate/runs`)을 유지한다. run 디렉터리를 옮기지 않는다.

## 5. 계약 변경 (`references/contracts.md` 1.1)

변경이 없는 계약(normalized input, author manifest, question, decision log, critic report)은 1.0 그대로다.

### 5.1 Work item — `external_ref` 추가

```yaml
  - id: T6                 # taskmaster 수입 항목은 T<id>, 하위는 T6.1
    external_ref: taskmaster:master:6     # 선택. <adapter>:<tag>:<id>
    ...                    # 나머지 필드는 1.0 과 동일
```

### 5.2 결정표 — `execution_format: table-v1`

```yaml
schema_version: "1.0"
task_id: W06
decision_id: bookmark_failure_cause
execution_format: table-v1      # 신규. review-only 는 계속 허용
hit_policy: FIRST               # UNIQUE | FIRST | ANY  (PRIORITY, COLLECT 는 table-v1 에서 거부)
ordered_rules: true             # FIRST 는 true, UNIQUE/ANY 는 false 여야 함
inputs:
  - name: volume_state
    type: string
    allowed_values: [mounted, unmounted, unknown]
    blank_means: any            # any | missing
outputs:
  - name: cause
    type: string
    allowed_values: [volume_unavailable, missing, access_denied, check_failed]
rules:
  - rule_id: R1
    when: {volume_state: unmounted}            # 셀: 리터럴 | [리터럴, ...] | any | 생략
    then: {cause: volume_unavailable}
default_rule: null              # 또는 { then: {...} }
gap_analysis: []                # table-v1 에서는 계산 결과에 대한 주석. 비어 있어도 됨
overlap_analysis: []            # FIRST 에서 overlap 이 계산되면 비어 있을 수 없음 (의도 설명)
source_locators: [...]
```

숫자 입력은 작성자가 **구간 라벨**을 `allowed_values`로 선언하고 셀에서도 그 라벨을 쓴다
(`allowed_values: ["< 100000", ">= 100000"]`). 평가기는 라벨을 enum으로 다룬다. 구간이 실수 영역을 빈틈없이
나누는지는 비평 차원이지 계산 차원이 아니다.

### 5.3 결정 벡터 — `<task>.decision.vectors.yaml`

`decision-vectors`가 table-v1 표 옆에 생성한다. 표와 같은 `spec_files` 항목으로 manifest에 넣어 fingerprint에
포함한다.

```yaml
schema_version: "1.0"
decision_id: bookmark_failure_cause
table: .spec-cycle/runs/<run-id>/specs/revision-0/W06.decision.yaml
table_fingerprint: <sha256>          # 표 파일. validate-author 가 재계산해 다르면 stale 오류
cells_total: 9
rules:
  - rule_id: R1
    obligation_id: W06-bookmark_failure_cause-R1
    wins:                            # 이 규칙이 최종 출력을 결정하는 셀
      - inputs: {volume_state: unmounted, error_kind: no_such_file}
        expected: {cause: volume_unavailable}
    shadowed: []                     # FIRST 에서 매칭되지만 앞 규칙에 밀린 셀 (정보용)
gaps: []                             # 비어 있어야 validate-author 통과 (default_rule 이 없을 때)
overlaps:                            # UNIQUE 는 비어 있어야 함
  - inputs: {volume_state: unmounted, error_kind: no_permission}
    rules: [R1, R2]
    winner: R1
```

### 5.4 Author manifest — table-v1 의무

table-v1 표를 가진 task는 **규칙마다** obligation 하나를 가져야 한다(validator).

```yaml
    test_obligations:
      - obligation_id: W06-bookmark_failure_cause-R1      # <task>-<decision_id>-<rule_id>
        kind: decision-rule
        source: .spec-cycle/runs/<run-id>/specs/revision-0/W06.decision.yaml#R1
```

review-only 표는 1.0 규칙(표 전체에 obligation 1개 이상)을 유지한다.

### 5.5 TDD handoff 1.1

```yaml
schema_version: "1.1"
...                                  # 1.0 필드 전부 유지
decision_vectors:                    # table-v1 표가 있을 때. 규칙 단위 벡터 (5.3 의 rules 와 동일 구조)
  - decision_id: bookmark_failure_cause
    rules: [...]
```

### 5.6 Spec brief — `<run_dir>/spec-brief.md`

`render-brief`가 handoff에서 결정론적으로 렌더한다. handoff가 바뀌지 않으면 바이트까지 같다. 절:

1. 작업 항목(id, 제목, route, acceptance refs, 기준 문서 경로와 fingerprint)
2. 승인된 명세 전문 — `.feature` 원문, 결정표(Markdown 표) + 계산된 셀 맵
3. Test obligations 표(id, kind, description, acceptance refs, source)
4. 결정 벡터(규칙별 입력 → 기대 출력)
5. 사람이 내린 결정(decision log) 과 승격된 결정 기록 경로
6. Non-blocking notes
7. **검증 계약**: "모든 테스트 이름 또는 태그에 그 테스트가 증명하는 `obligation_id`를 포함한다. `verify`가 이 문자열을 찾는다."

### 5.7 Plan 검사 결과 — stdout

`check-plan --plan <file> --handoff <file>`은 handoff의 모든 `obligation_id`가 plan 본문에 나타나는지 확인하고
`missing: [...]`를 돌려준다. 비어 있지 않으면 종료 코드 1.

### 5.8 검증 보고 — `<run_dir>/verification.yaml`

```yaml
schema_version: "1.0"
run_id: t-w06-c0dec005
task_id: W06
checked_at: <ISO-8601>
test_globs: [...]
obligations:
  - obligation_id: W06-create-bookmark
    covered: true
    locations: [FianchettoTests/Platform/BookmarkTests.swift:42]
  - obligation_id: W06-bookmark_failure_cause-R4
    covered: false
    locations: []
uncovered_count: 1
test_command: null | { command: "...", exit_code: 0 }
status_written: null | done
```

## 6. Intake 어댑터

공통 계약: **어댑터의 출력은 `docs/work-items.yaml`이며, 그 아래는 어댑터를 모른다.** `resolve-inputs`의
notice(`source_refs` 없음) 규칙이 수입 초안의 보강을 강제한다.

### 6.1 native

fianchetto-spec-gate의 `work-items` 스킬 그대로. 기준 문서·결정 기록을 읽어 항목을 도출하고 `source_refs`·
`acceptance_refs`를 단다.

### 6.2 taskmaster

`work-items` 스킬이 `intake.adapter: taskmaster`를 보면 먼저 스크립트를 돌리고, 그 초안을 native 규칙으로 보강한다.

```text
node <root>/scripts/spec-cycle.mjs import-taskmaster [--tasks path] [--tag name] [--work-items path]
```

매핑(Task Master 0.43.1 스키마 기준, 태그 형식 `{ <tag>: { tasks: [...] } }`와 레거시 `{ tasks: [...] }`,
배열 모두 수용):

| Task Master | work item | 규칙 |
| --- | --- | --- |
| `id` 6 / 6.1 | `id: T6` / `T6.1` | 점은 하위 항목 표기로 예약된 것과 일치 |
| — | `external_ref: taskmaster:<tag>:6` | 재수입 시 매칭 키 |
| `title`, `description`, `details` | 동일 | 재수입 시 덮어씀 |
| `testStrategy` | `test_strategy` | 재수입 시 덮어씀 |
| `priority` | 동일 | 값이 high/medium/low 밖이면 `medium` + warning |
| `dependencies` [4, 5.2] | `[T4, T5.2]` | |
| `status` pending/in-progress/done/review/deferred/cancelled | pending/in-progress/done/in-progress/deferred/deferred | **최초 수입에만** 복사. 재수입 시 로컬 상태 유지, 다른 값이면 warning |
| `acceptanceCriteria` (자유 텍스트, 선택) | `details`에 "Acceptance criteria (Task Master)" 절로 덧붙임. `acceptance_refs: []` | ID 부여는 스킬이 기준 문서를 읽고 수행 |
| — | `source_refs: []` | 비어 있으므로 notice → 스킬이 보강 |
| TM에서 사라진 항목 | `status: deferred`, `details`에 사유 | id는 지우지 않음 |

재수입은 `external_ref`로 기존 항목을 찾고, 로컬에서 보강한 `source_refs`·`acceptance_refs`·`status`를 보존한다.
`work-items.yaml` 쓰기는 `yaml` 라이브러리의 Document API로 하여 주석을 보존한다.

### 6.3 `init`의 감지

`detect`가 아래를 JSON으로 보고하고, `init` 커맨드가 그것으로 config 기본값을 채운다. 후보가 여럿이면
`AskUserQuestion`으로 고른다.

- Task Master: `which task-master`, `.taskmaster/tasks/tasks.json` 존재 → `intake.adapter: taskmaster` 제안
- superpowers: `claude plugin list` 출력에 `superpowers@` 포함 → `execution.adapter: superpowers` 제안. 없으면 `inline`
- 기준 문서 후보: `docs/PRD.md`, `docs/TECH_STACK.md`, `docs/REQUIREMENT*.md`, `.taskmaster/docs/prd.md`,
  `docs/superpowers/specs/*.md`
- 결정 기록 후보: `docs/decisions/`
- 테스트 glob 후보: `*Tests/**/*.swift`, `tests/**`, `test/**`, `src/**/*.spec.ts`, `src/**/*.test.ts` 중 존재하는 것
- 기존 `.spec-gate/config.yaml` → `--adopt` 제안

`init`은 기존 `.spec-cycle/config.yaml`을 덮어쓰지 않는다(현행 `init` 규칙 유지).

## 7. 게이트 (`run`)

fianchetto-spec-gate `commands/run.md`를 계승한다. 바뀌는 것:

- 스크립트 경로와 네임스페이스(`/spec-cycle:run`).
- 작성 단계: route가 DMN/BOTH면 table-v1로 쓰고 `decision-vectors`를 실행해 벡터 파일을 `spec_files`에 넣는다.
  `review-only`는 table-v1 문법으로 표현할 수 없는 표(비유한 도메인, COLLECT 등)에만 쓰고 그 이유를 `assumptions`에 적는다.
- 비평 단계: critic은 table-v1 표에 대해 `check-decision`을 실행하고 그 출력(gaps/overlaps)을 근거로 쓴다.
  산문 `gap_analysis`를 증거로 받지 않는다.
- 마지막 안내: `execution.adapter`에 맞춰 다음 커맨드 한 줄(`/spec-cycle:implement W06` 또는 설정된 커맨드)을 보인다.
  **TDD를 시작하지 않는다.**

## 8. 구현 인계 (`implement <work-item-id>`)

### 8.1 handoff 해석 — `resolve-handoff --task W06`

`run_root` 아래에서 해당 task의 `tdd-handoff.yaml`을 가진 run 중 가장 최근 것을 찾고 사용 가능 여부를 판정한다.

| 조건 | 결과 |
| --- | --- |
| handoff 없음 | 오류: 먼저 `/spec-cycle:run W06` |
| 기준 문서 fingerprint 불일치 | 오류: 기준 문서가 바뀌었으니 게이트를 다시 통과 |
| 작업 항목의 **정의 필드**(title, description, details, test_strategy, dependencies, source_refs, acceptance_refs) 불일치 | 오류: 항목이 바뀌었으니 게이트 재통과. `status`는 비교하지 않는다 |
| 결정 기록 fingerprint 불일치 | warning: 그 run 이후 추가된 결정 기록 목록을 보임. 승격은 설계상 fingerprint를 바꾸므로 오류가 아니다 |
| 작업 항목이 이미 `done` | warning + `AskUserQuestion` 확인 |

### 8.2 공통 단계

1. `resolve-handoff` → run_dir, handoff 경로.
2. `render-brief --handoff <file> --out <run_dir>/spec-brief.md` (존재하면 내용이 같을 때만 통과, 다르면 덮어쓰지 않고 오류).
3. `set-status --task W06 --status in-progress` (이미 `in-progress`면 무시).
4. 어댑터 분기.

### 8.3 superpowers 어댑터

1. `superpowers:writing-plans` 스킬을 호출한다. Spec은 `spec-brief.md`. 커맨드가 명시하는 규약:
   - "brainstorming은 명세 게이트가 대신했다. READY handoff가 승인된 spec이다. brainstorming을 호출하지 않는다."
   - "plan의 모든 task는 `**Obligations:**` 줄에 그 task가 증명하는 `obligation_id`를 나열한다."
   - "테스트 이름/태그에 `obligation_id`를 넣는다."
2. plan이 저장되면 `check-plan --plan <plan> --handoff <handoff>`를 실행한다. `missing`이 있으면 plan을 보완하고 다시 검사한다.
   superpowers의 plan 검토 질문(실행 방식 선택)은 **그대로 사람에게 간다.** 중복 승인을 만들지 않는다.
3. 실행은 superpowers가 고른 스킬(`subagent-driven-development` 또는 `executing-plans`)이 맡는다.
   plan 실행이 끝나면 `superpowers:finishing-a-development-branch` 전에 `/spec-cycle:verify W06`을 돌리라고 안내한다.

superpowers가 설치되어 있지 않으면(`detect`) 오류 대신 `inline`으로 내려가고 그 사실을 보고한다.

### 8.4 inline 어댑터

fianchetto-spec-gate `run.md` 5절의 현행 동작. brief를 요약해 보이고, 사람이 지시하면 같은 세션에서 obligation을
하나씩 실패하는 테스트로 옮기는 TDD를 한다. `superpowers:test-driven-development`가 있으면 그 스킬을 쓴다.

### 8.5 command 어댑터

`execution.command`에 설정된 슬래시 커맨드를 **작업 항목의 외부 ID**로 호출하도록 안내한다
(`external_ref: taskmaster:master:6` → `/task-cycle 6`; 없으면 work item id). 호출 전에 `spec-brief.md`를 읽게 한다.
stemus `specification-gate`의 통합 방식(handoff를 읽힌 뒤 기존 커맨드에 task ID만 전달)과 같다. 플러그인은 그
커맨드를 대신 실행하지 않는다.

## 9. 결정표 평가기 (`lib/decision.mjs`)

### 9.1 도메인과 셀

- 입력 `i`의 도메인 `D_i` = `allowed_values`. `blank_means: missing`이면 `<missing>`을 추가한다.
- 셀 = 모든 입력에 값을 하나씩 고른 조합. 전체 수 = ∏|D_i|. **10,000을 넘으면 오류**(표를 나누라고 안내).
- 규칙의 `when[i]` 해석: 리터럴 → 그 값 / 목록 → 그 중 하나 / `any` → 도메인 전체 / 생략 → `blank_means`가
  `any`면 도메인 전체, `missing`이면 `<missing>`만.
- `when`의 리터럴이 `D_i` 밖이거나 `then`의 값이 출력 `allowed_values` 밖이면 오류.
- `default_rule`이 있으면 어떤 규칙에도 매칭되지 않는 셀은 `rule_id: DEFAULT` 아래에 `wins`로 묶이고,
  obligation `<task>-<decision_id>-DEFAULT`를 요구한다. 그런 셀이 하나도 없는데 `default_rule`이 선언되어 있으면
  "도달 불가 기본 규칙" 오류다.

### 9.2 hit policy

| 정책 | `ordered_rules` | 셀에 매칭 규칙 0개 | 2개 이상 |
| --- | --- | --- | --- |
| UNIQUE | false | `default_rule` 없으면 gap 오류 | overlap 오류 |
| FIRST | true | 같음 | 선언 순서 첫 규칙이 승자. `overlap_analysis`가 비어 있으면 오류 |
| ANY | false | 같음 | 모든 매칭 규칙의 `then`이 같아야 함. 다르면 오류 |
| PRIORITY, COLLECT | — | table-v1 거부. review-only 사용 안내 | |

### 9.3 명령

- `check-decision --table <file>`: 위 계산을 하고 `gaps`, `overlaps`, `rules[].wins/shadowed`를 YAML로 출력. 오류가 있으면 종료 코드 1.
- `decision-vectors --table <file> --out <file>`: `check-decision`이 통과한 표에서 §5.3 벡터 파일을 쓴다.
- `validate-author`: table-v1 표마다 `check-decision`을 다시 실행하고, 벡터 파일의 `table_fingerprint`가 현재 표와 같은지,
  규칙마다 obligation이 있는지 확인한다.
- `build-handoff`: 벡터를 `decision_vectors`로 싣는다.

### 9.4 기존 표

fianchetto의 review-only 표 8개는 그대로 유효하다. 새 run에서 같은 작업 항목을 다시 게이트에 넣으면 작성자는
table-v1로 다시 쓴다.

## 10. 검증 (`verify <work-item-id>`)

1. `resolve-handoff`(§8.1)로 handoff를 찾는다.
2. `verify-obligations --task W06 --out <run_dir>/verification.yaml`:
   - `verification.test_globs`로 파일을 모아 obligation마다 `id_pattern`(기본은 리터럴)으로 검색한다.
   - 파일별 `경로:줄`을 `locations`에 적는다.
   - glob이 비었거나 파일이 0개면 오류(설정 안내).
3. `verification.test_command`가 있으면 실행하고 종료 코드를 기록한다. 없으면 커맨드가 프로젝트 테스트를 사람이 돌렸는지
   `AskUserQuestion`으로 확인하고, 답을 보고에 `human_confirmed_tests: true`로 남긴다.
4. 미커버 0개이고 테스트가 통과(또는 확인)했을 때만 `set-status --task W06 --status done`. 아니면 미커버 목록을 보이고 상태를 두지 않는다.
5. `status` 서브커맨드는 작업 항목 × 최신 run 판정 × handoff 유무 × 커버리지(n/m)를 표로 낸다. `init` 뒤, 사이클 중간 점검용.

커버리지는 **존재 검사**다. 테스트가 실제로 그 obligation을 올바르게 증명하는지는 superpowers 리뷰(또는 사람)의 몫이고,
브리프 §7의 검증 계약이 그 연결을 요구한다.

## 11. 실패 경로

| 상황 | 동작 |
| --- | --- |
| `${CLAUDE_PLUGIN_ROOT}` 미확장 | 현행 규칙: `scripts/spec-cycle.mjs`를 포함한 디렉터리를 찾아 절대경로 사용 |
| `node_modules` 누락 | 스크립트 첫 줄에서 `yaml` import 실패를 잡아 "플러그인 설치본에 node_modules가 없다"는 메시지로 종료 |
| Task Master `tasks.json` 없음·태그 없음 | import 오류, 후보 태그 목록 제시 |
| superpowers 미설치 | `inline`으로 내려가고 보고. config는 바꾸지 않음 |
| `check-plan` missing | plan 보완 요청. 실행 단계로 넘기지 않음 |
| 결정표 셀 10,000 초과 | 오류. 표 분할 안내 |
| `verify` 중 테스트 명령 실패 | 보고에 기록, 상태 변경 없음 |
| `set-status` 대상 항목 없음 / 허용되지 않은 전이 | 오류. 허용 전이: pending→in-progress, in-progress→done, pending→done(verify가 직접) |

## 12. 설치와 마이그레이션

```bash
claude plugin marketplace add /Users/unae/Documents/u.naee/spec-cycle
claude plugin install spec-cycle@spec-cycle
```

- **fianchetto**: `fianchetto-spec-gate`를 유지한 채 `/spec-cycle:init --adopt .spec-gate/config.yaml`로 config를 만든다.
  남은 항목(W20~W27)부터 spec-cycle로 돌린다. 완료된 run 22개는 그대로 읽힌다(handoff 1.0 호환). 두 플러그인을 다 쓰지
  않으려면 `fianchetto-spec-gate`를 uninstall한다. fianchetto 저장소의 `CLAUDE.md`는 사용자가 따로 고친다.
- **stemus 프로젝트**: `intake.adapter: taskmaster`, `execution.adapter: command`, `command: "/task-cycle"`.
  팀 플러그인은 건드리지 않는다(원본의 경계 원칙 유지).

## 13. 테스트 전략

`node --test`. 기존 43개는 `tests/core.test.mjs`로 옮겨 그대로 통과한다. 추가:

| 모듈 | 테스트 |
| --- | --- |
| config | 1.0 파일이 기본 어댑터로 읽힘 / 1.1 필드 검증 / 알 수 없는 adapter 값 거부 |
| intake-taskmaster | 태그·레거시·배열 형식 / 하위 task 점 표기 / 상태 매핑 / acceptanceCriteria 덧붙임 / 재수입 시 로컬 보강 보존 / 사라진 항목 deferred / 주석 보존 / 태그 없음 오류 |
| decision | UNIQUE gap·overlap 검출 / FIRST 승자·shadowed / ANY 동일 출력 / blank_means missing 도메인 / 리터럴 범위 밖 오류 / 셀 상한 / 벡터 파일 stale 검출 / 규칙별 obligation 누락 거부 / review-only 표 그대로 통과 |
| brief | 같은 handoff → 같은 바이트 / 모든 obligation 포함 / 벡터 포함 / check-plan missing 검출·빈 결과 |
| verify | 커버·미커버 / 빈 glob 오류 / id_pattern 치환 / verification.yaml 형식 / set-status 허용 전이만 |
| resolve-handoff | 없음 / 기준 문서 변경 / 정의 필드 변경 / 결정 기록만 변경(warning) / 가장 최근 run 선택 |
| detect | superpowers 유무 / task-master 유무 / 기준 문서 후보 |
| fixtures | 기존 6종 + `taskmaster`(tasks.json → work-items → 게이트 READY) 1종. `dmn`·`both` fixture는 table-v1로 갱신하고 벡터 포함 |

테스트는 임시 디렉터리를 만들고 지우며, 실제 `claude`·`task-master` CLI를 호출하지 않는다(`detect`는 주입된 실행기로 검사).

## 14. 성공 기준

- `claude plugin validate . --strict` 통과, `claude --plugin-dir . plugin details spec-cycle` 로드.
- `npm test` 전부 통과, fixture 7종 통과.
- 1.0 config·run·handoff가 수정 없이 읽힌다.
- fianchetto W20을 `init --adopt → run → implement(superpowers) → verify`로 한 번 통과한다. 이것이 첫 실전 검증이며
  `docs/validation-results.md`에 기록한다.

## 15. 결정 기록 (이 설계에서 사용자와 합의한 것)

| 결정 | 선택 | 대안과 이유 |
| --- | --- | --- |
| Task Master 역할 | intake 어댑터 중 하나, native가 기본 | 필수 앞단으로 두면 `acceptance_refs`·`source_refs` 부재로 게이트 보증이 약해짐 |
| 대상 범위 | 개인 + 회사 프로젝트 | execution 어댑터로 superpowers / task-cycle 모두 수용 |
| 게이트–구현 경계 | 사람이 `run` → `implement` → `verify`를 따로 호출 | 한 커맨드로 묶으면 READY 직후 코드가 쓰이고 superpowers plan 승인과 중복 |
| 이름 | `spec-cycle` | `spec-gate`는 기존 디렉터리와 이름이 겹침 |
| Task Master 상태 | v1 단방향 수입, `external_ref` 보존 | write-back은 상태 출처를 둘로 만들고 CLI 실패 경로가 생김 |
| DMN | 자체 평가기 `table-v1` | 실전 표 8개가 전부 유한 enum. 외부 FEEL/DMN 엔진은 hit policy 지원이 없고 의존성 비용만 생김 |
