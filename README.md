# spec-cycle

기준 문서에서 뽑은 작업 항목이 **독립 비평을 통과한 명세**를 갖춘 뒤에만 구현에 들어가고, 구현이 끝나면
**그 명세의 test obligation이 실제 테스트로 덮였는지 확인**하는 Claude Code 플러그인입니다.

```text
[Intake]                    [Core gate]                                  [Execution]
 native   work-items 스킬     resolve-inputs → author → critic(독립)       superpowers  writing-plans → SDD / executing-plans
 taskmaster tasks.json 수입   → 판정 루프(revision ≤ 2) → tdd-handoff       inline       handoff 요약 + 세션 내 TDD
     ↓ work-items.yaml        → 결정 기록 승격                              command      설정된 커맨드(예: /task-cycle 6)
                                                   ↓ tdd-handoff.yaml + spec-brief.md
                               [Close the loop]  verify-obligations → 통과 시에만 작업 항목 done
```

요구사항을 구현하거나 테스트를 쓰는 도구가 아닙니다. 작업 항목마다 형식 명세가 필요한지 판단하고, 독립 비평을
통과한 결과만 구현으로 넘기며, 구현 뒤에 obligation 커버리지를 확인합니다. 앞단(intake)과 뒷단(execution)은
`.spec-cycle/config.yaml` 의 어댑터 선택으로 바뀌므로 프로젝트마다 플러그인 파일을 고치지 않습니다.

## 핵심 설계

| 영역 | 방식 |
| --- | --- |
| 설정 | `.spec-cycle/config.yaml` 의 `intake` / `execution` / `verification` 어댑터 선택. 플러그인 파일은 그대로 |
| 입력 | **기준 문서 묶음 + 결정 기록 디렉터리**와 `docs/work-items.yaml`. 각각 fingerprint를 남겨 바뀌면 이전 run을 무효로 처리 |
| 작업 항목 | `work-items` 스킬이 도출하거나 Task Master `tasks.json` 을 수입. 항목마다 `source_refs`, `acceptance_refs` |
| 정책 질문 | **권장안(`recommended_default`)과 근거 필수.** 선택지마다 영향(`detail`) 필수. 검증기가 강제 |
| 결정 로그 | 원래 질문·권장안·답변·채택 여부를 보존. READY 후 결정 기록으로 승격 |
| 결정표 | `table-v1`: 스크립트가 셀을 열거해 gap/overlap을 **계산**하고 규칙 단위 obligation과 테스트 벡터를 생성 |
| 구현 인계 | `implement` 가 brief를 만들어 `superpowers` / `inline` / `command` 중 설정된 어댑터에 넘김 |
| 상태 | 작업 항목 상태는 `implement`(→ `in-progress`)와 `verify`(→ `done`)에서만, 스크립트로만 바뀜 |

게이트의 성질은 다음으로 지킵니다. 사람만 호출(`disable-model-invocation`), 작성자와 비평자 컨텍스트 분리,
스크립트가 판정 규칙·revision 한도·READY 전용 handoff를 강제, `done` 은 커버리지가 완전할 때만 기록.

## 구성 요소

| 이름 | 종류 | 역할 |
| --- | --- | --- |
| `/spec-cycle:init` | 커맨드 | 환경 감지 → `.spec-cycle/config.yaml` 생성 (`--adopt` 로 1.0 설정 채택) |
| `/spec-cycle:run` | 커맨드 | 입력 해석 → 작성 → 독립 비평 → 판정 처리 → handoff → 결정 기록 승격 |
| `/spec-cycle:implement` | 커맨드 | READY handoff → `spec-brief.md` → 실행 어댑터 인계 |
| `/spec-cycle:verify` | 커맨드 | obligation 커버리지 검증, 통과 시에만 `done` |
| `work-items` | 스킬 | 기준 문서·결정 기록에서 `docs/work-items.yaml` 도출·갱신 |
| `specification-author` | 스킬 | 라우팅(PASS/GHERKIN/DMN/BOTH)과 명세 작성, 수정, 답변 반영 |
| `specification-critic` | 스킬 (`context: fork`) | 사람이 직접 부르는 독립 비평 |
| `specification-critic-agent` | 에이전트 | `run` 이 부르는 독립 비평 |
| `scripts/spec-cycle.mjs` | 스크립트 | 모든 판정·검증·상태 전이를 수행하는 CLI (인자 없이 실행하면 목록 출력) |

세부 계약은 [`references/contracts.md`](references/contracts.md), 어댑터 계약은
[`references/adapters.md`](references/adapters.md), 실행 흐름과 결정 기록 형식은
[`docs/integration.md`](docs/integration.md)에 있습니다.

## 요구 환경

- Claude Code 2.1.231 이상
- Node.js 20.11 이상
- superpowers 플러그인 (선택) — 없으면 `execution.adapter: superpowers` 는 `inline` 으로 내려갑니다
- Task Master (선택) — `intake.adapter: taskmaster` 를 쓸 때만
- 런타임 의존성(`yaml`, `@cucumber/gherkin`)은 `node_modules/` 째로 저장소에 포함합니다. 플러그인 설치는
  파일 복사만 하고 `npm install` 을 실행하지 않기 때문입니다. `npm` 은 플러그인을 고칠 때만 필요합니다.

항상 켜져 있는 토큰 비용: 세션마다 약 847 토큰 (`claude plugin details spec-cycle` 의 projected token cost).

## 설치

```bash
claude plugin marketplace add /Users/unae/Documents/u.naee/spec-cycle
claude plugin install spec-cycle@spec-cycle
```

설치본은 `plugin.json` 의 `version` 기준 **스냅숏 복사본**입니다. 소스를 고친 뒤에는 버전을 올려
`claude plugin update spec-cycle@spec-cycle` 하거나 uninstall 후 다시 install 하고, 새 세션에서 반영됩니다.
플러그인을 활발히 고치는 중이면 `claude --plugin-dir <경로>` 로 소스 디렉터리를 직접 붙이는 편이 낫습니다.

## 프로젝트에서 쓰기

`init → work-items → run → implement → verify` 순서입니다. 모든 단계는 사람이 호출합니다.

### 1. `/spec-cycle:init` (프로젝트당 1회)

환경을 감지(`detect`)해 기준 문서·intake·execution·테스트 glob 후보를 정하고, 모호하면 권장안을 붙여 묻습니다.
`.spec-cycle/config.yaml`, 빈 `docs/work-items.yaml`, 결정 기록 디렉터리를 만들고 생성 파일과 선택된 어댑터를
표로 보고합니다. 기존 설정은 덮어쓰지 않습니다. 기존 `.spec-gate/config.yaml` 이 있으면 `--adopt` 를 제안합니다.

### 2. `/spec-cycle:work-items`

기준 문서의 구현 순서·범위·수용 기준을 읽고 작업 항목(`W01`, `W02`, …)을 만들거나 갱신합니다. 항목마다 근거
위치(`source_refs`)와 책임지는 수용 기준(`acceptance_refs`)을 답니다. intake가 `taskmaster` 면
`import-taskmaster` 로 `tasks.json` 을 같은 계약의 초안으로 수입합니다.

### 3. `/spec-cycle:run W05`

게이트를 한 번 돌립니다. 정책 모호성이 나오면 에이전트가 먼저 판단해 **권장안을 붙여** 질문하고, 답은 결정
로그에 남아 READY 후 결정 기록으로 옮겨집니다. READY가 되면 `.spec-cycle/runs/<run-id>/tdd-handoff.yaml` 이
생기고, 마지막에 설정된 어댑터에 맞는 다음 커맨드 한 줄을 안내합니다. 구현은 시작하지 않습니다.

### 4. `/spec-cycle:implement W05`

handoff가 현재 입력과 맞는지 확인(`resolve-handoff`)하고 `spec-brief.md` 를 만들고 상태를 `in-progress` 로 바꾼 뒤
어댑터로 넘깁니다. `superpowers` 는 `superpowers:writing-plans` 에 brief를 spec으로 넘기고, 저장된 plan이 모든
obligation을 배정했는지 `check-plan` 으로 검사합니다. `inline` 은 사람이 지시하면 세션 안에서 obligation별 TDD를 합니다.
`command` 는 설정된 커맨드를 외부 id로 호출하도록 안내만 합니다.

### 5. `/spec-cycle:verify W05`

`verification.test_globs` 의 테스트 파일에서 `obligation_id` 를 찾아 커버리지를 보고합니다. `test_command` 가 있으면
실행하고, 없으면 테스트를 돌렸는지 묻습니다. **미커버가 0이고 테스트가 통과(또는 확인)했을 때만** `done` 이 됩니다.
`status` 서브커맨드로 작업 항목 × 최신 판정 × handoff × 커버리지를 표로 볼 수 있습니다.

## 설정 예

### 개인 프로젝트 (native + superpowers)

```yaml
schema_version: "1.1"
baseline: [docs/PRD.md, docs/TECH_STACK.md]
decision_records: docs/decisions
work_items: docs/work-items.yaml
run_root: .spec-cycle/runs
intake: { adapter: native }
execution: { adapter: superpowers, plan_dir: docs/superpowers/plans }
verification:
  test_globs: ["*Tests/**/*.swift"]
```

### Task Master 팀 프로젝트 (taskmaster + command)

```yaml
schema_version: "1.1"
baseline: [.taskmaster/docs/prd.md]
decision_records: null
work_items: docs/work-items.yaml
run_root: .spec-cycle/runs
intake:
  adapter: taskmaster
  taskmaster: { tasks: .taskmaster/tasks/tasks.json, tag: null }
execution: { adapter: command, command: /task-cycle }
verification:
  test_globs: ["src/**/*.spec.ts"]
```

`/spec-cycle:implement` 는 `external_ref: taskmaster:master:6` 인 항목에 대해 `/task-cycle 6` 을 호출하라고 안내합니다.

### 1.0 설정 채택

```bash
node <plugin>/scripts/spec-cycle.mjs init --adopt .spec-gate/config.yaml
```

기존 값을 복사해 `.spec-cycle/config.yaml` 을 만들고 `run_root` 는 원래 값을 유지합니다. 기존 run 디렉터리는
옮기지 않고 그대로 읽힙니다. 1.0 설정은 `intake: native`, `execution: inline`, `test_globs: []` 로 읽히므로
`verify` 전에 `verification.test_globs` 를 채워야 합니다.

## 판정

| 판정 | 의미 | 다음 단계 |
| --- | --- | --- |
| `READY` | critical/major 발견과 blocking 질문 없음 | handoff 생성 → 결정 기록 승격 → `implement` |
| `REVISE` | 근거 문서만으로 고칠 수 있음 | 새 revision 작성 후 재비평 |
| `NEEDS_HUMAN` | 새 정책 결정 필요 | 권장안과 함께 질문 → 답 반영 → 재비평 |
| `BLOCKED_AT_LIMIT` | 수정 2회를 넘김 | 중단하고 남은 문제를 사람에게 보고 |

기준 문서, 결정 기록 집합, 작업 항목 정의 중 하나라도 바뀌면 그 이전에 작성한 run은 무효가 되고 새 run_id를 받습니다.

## 결정표 `table-v1`

결정표는 `execution_format: table-v1` 로 씁니다. 스크립트가 입력 도메인의 모든 셀을 열거해 gap과 overlap을 계산하므로
작성자의 산문 주장이 증거가 되지 않습니다.

- **셀 문법**: 리터럴 | `[리터럴, ...]` | `any` | 생략(= `blank_means`). hit policy는 `UNIQUE`, `FIRST`, `ANY`
  (`FIRST` 는 `ordered_rules: true`).
- **구간 라벨**: 숫자 입력은 `allowed_values: ["< 100000", ">= 100000"]` 처럼 라벨을 선언하고 셀에서도 그 라벨을 씁니다.
- **규칙 단위 obligation**: 규칙마다 test obligation이 생기고, `decision-vectors` 가 규칙별 테스트 벡터
  (`<task>.decision.vectors.yaml`)를 만듭니다.
- **`check-decision`**: 비평자가 표마다 실행해 gaps/overlaps를 근거로 씁니다.
- `review-only` 는 table-v1로 표현할 수 없는 표에만 쓰고 이유를 `assumptions` 에 적습니다.

## 검증

```bash
npm test                  # 자동 테스트
npm run validate          # claude plugin validate --strict + plugin details + 테스트
npm run validate:fixtures # fixture 계약 검증
npm run metrics           # fixture 지표 → reports/fixture-metrics.yaml
```

결과는 [`docs/validation-results.md`](docs/validation-results.md)에 있습니다.

## 현재 제한 사항

- Task Master `tasks.json` 으로 상태를 되돌려 쓰지 않습니다(단방향 수입).
- DMN 1.3 XML 내보내기와 외부 DMN/FEEL 엔진이 없습니다.
- 커버리지는 **존재 검사**입니다. 테스트 파일에 `obligation_id` 가 있다는 것만 확인하며, 테스트가 obligation을
  올바르게 증명하는지는 리뷰(또는 사람)의 몫입니다.
- 실전 표본이 0건입니다. fixture 결과는 동작 검증일 뿐 효과의 근거가 아닙니다.
- hook 자동화는 없습니다. 모든 진입점을 사람이 호출합니다.
