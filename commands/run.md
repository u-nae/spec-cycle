---
description: "명세 게이트 1회 실행 — 입력 해석 → 명세 작성 → 독립 비평 → 판정별 처리 → READY 시 TDD handoff 생성"
argument-hint: "[work-item-id] [--config path]"
---

# 명세 게이트 실행

작업 항목 하나(또는 하위 항목 묶음)를 명세 게이트에 통과시킨다. 사람이 이 커맨드를 직접 호출한
것 자체가 게이트를 열겠다는 결정이다. **게이트를 돌릴지 여부를 다시 판단하지 말고 실행한다.**

`$ARGUMENTS` — 대상 작업 항목 ID와 선택적 플래그. 생략 시 `docs/work-items.yaml` 의 `pending` 항목 중
의존성이 모두 `done` 인 후보를 제시하고 사람에게 고르게 한다. 추측하지 않는다.

## 이 커맨드가 하지 않는 것

- 구현을 시작하지 않는다. handoff 를 만들어 다음 커맨드를 안내하는 것까지가 범위다(`/spec-cycle:implement`).
- 애플리케이션 코드나 테스트를 쓰지 않는다.
- 작업 항목 상태를 바꾸지 않는다.

## 플러그인 경로

이하 `PLUGIN_ROOT` 는 `${CLAUDE_PLUGIN_ROOT}` 다. 이 변수가 그대로 문자열로 남아 확장되지
않았다면, `scripts/spec-cycle.mjs` 를 포함한 플러그인 디렉터리를 찾아 그 절대경로를 쓴다.

## 1. 입력 해석

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs resolve-inputs [--project <dir>] [--config <path>] [--task <id>]
```

직접 파일을 탐색하지 않는다. 해석기가 설정 파일·기준 문서와 fingerprint·결정 기록·작업 항목·
`run_id`·`run_dir` 과 그대로 실행 가능한 `normalize_command` 를 돌려준다.

**진행 전에 반드시 처리한다.**

- **설정 없음** — `init` 안내가 나온다. 프로젝트의 기준 문서를 확인해 `init` 을 실행하고 다시 해석한다.
- **`notices`** — 추적성 결함이다. 사람에게 묻지 않고 작업 항목의 `source_refs` 를 고친 뒤 다시 해석한다.
- **`warnings`** — `AskUserQuestion` 으로 확인을 받고 나서 진행한다. 작업 항목이 `pending` 을 벗어났다면
  산출물은 게이트가 아니라 사후 문서화가 된다. 사람이 그래도 진행하라고 하면 진행하고 최종 보고에 남긴다.
- **`git.ignored: false` 이고 `gitignore_hint` 존재** — run 산출물이 git 추적 디렉터리에 떨어진다고
  알리고 hint 를 제시한다. **`.gitignore` 를 직접 수정하지 않는다.**
- **`run_dir_status: exists`** — 같은 입력으로 이미 시작된 run 이다. 새 run 이 아니라 revision 또는
  resume 으로 다룬다.

그다음 보고된 `normalize_command` 를 그대로 실행한다.

## 2. 명세 작성

`PLUGIN_ROOT/skills/specification-author/SKILL.md` 를 읽고 그 문서의 **"Author a new run"** 절을
그대로 수행한다. 작성 규칙의 단일 출처는 그 파일이며 여기에 복제하지 않는다.

route 가 DMN 또는 BOTH 면 결정표를 `execution_format: table-v1` 으로 쓴다. 표를 쓴 뒤 벡터를 생성하고
생성된 `<task>.decision.vectors.yaml` 을 manifest 의 `spec_files` 에 넣는다.

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs decision-vectors --table <task>.decision.yaml --out <task>.decision.vectors.yaml
```

규칙마다 별도 test obligation 을 둔다(규칙 단위 obligation). `review-only` 는 table-v1 문법으로 표현할 수 없는
표(비유한 도메인, COLLECT 등)에만 쓰고 그 이유를 `assumptions` 에 적는다.

작성이 끝나면 검증한다.

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs validate-author --manifest <run_dir>/author-manifest-revision-0.yaml
```

**READY 라고 선언하지 않는다.** 작성자는 자기 결과를 승인할 수 없다.

## 3. 독립 비평

`specification-critic-agent` 서브에이전트를 호출한다. **비평을 이 컨텍스트에서 직접 수행하지
않는다.** 작성자와 비평자가 같은 컨텍스트를 공유하면 이 게이트의 유일한 보증이 사라진다.

비평자는 table-v1 결정표마다 `check-decision --table <file>` 을 실행하고 그 출력(gaps/overlaps)을 근거로
쓴다. 산문 `gap_analysis` 는 증거로 받지 않는다. 에이전트 프롬프트에 이 지시와 함께 절대경로 두 개를
명시해 넘긴다.

- `PLUGIN_ROOT` — 플러그인 디렉터리 절대경로
- `MANIFEST` — 검토할 author manifest 절대경로

에이전트가 돌려주는 `verdict`·`report_path`·`blocking_questions`·`revisable_findings` 를 받는다.

## 4. 판정별 처리

`max_revisions` 는 2다. 아래 루프는 **최대 두 번의 revision** 까지만 돈다. 3번째 비평 패스는
`READY` 또는 `BLOCKED_AT_LIMIT` 이어야 한다.

### READY

handoff 를 생성한다.

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs build-handoff \
  --manifest <manifest> --report <ready-report> --out <run_dir>/tdd-handoff.yaml \
  [--decision-log <run_dir>/decision-log.yaml]
```

`decision-log.yaml` 이 존재하면 반드시 함께 넘긴다. 5번 절로 간다.

### REVISE

`SKILL.md` 의 **"Revise from a critic report"** 절을 수행한다. 새 revision 경로에 쓰고 이전
manifest·critic 리포트를 보존한다. `revision_count` 를 정확히 1 증가시킨다. 그다음 **3번으로
돌아가 새 fingerprint 에 대해 비평을 다시 받는다.** 이전 판정을 재사용하지 않는다.

발견을 닫기 위해 근거 없는 정책을 만들어내지 않는다. 근거가 없으면 그 발견은 권장안을 붙인 질문이다.

### NEEDS_HUMAN

1. 미응답 blocking 질문을 `AskUserQuestion` 으로 작은 묶음씩 제시한다. 권장 선택지를 첫 번째에
   "(권장)" 표시와 함께 두고, 설명에 `recommendation_rationale` 을, 각 선택지 설명에 `detail` 을 싣는다.
   **답을 추론하지 않는다.**
2. `SKILL.md` 의 **"Resume from human answers"** 절을 수행해 원문 질문·권장안·실제 답변을
   `decision-log.yaml` 에 함께 보존한다.
3. 영향받은 작업 항목만 새 revision 으로 만들고 3번으로 돌아간다.

### BLOCKED_AT_LIMIT

자동 진행을 멈춘다. 남은 critical/major 발견과 blocking 질문을 정리해 사람에게 보고한다.
**handoff 를 만들지 않는다.** 스크립트도 이를 거부한다. 한계 도달을 성공으로 바꾸지 않는다.

## 5. 결정 기록 승격과 handoff 요약

1. `decision-log.yaml` 이 있으면 각 결정을 프로젝트 결정 기록(`.spec-cycle/config.yaml` 의
   `decision_records`)으로 옮긴다. 형식은 `PLUGIN_ROOT/docs/integration.md` 의 "결정 기록 승격"을 따른다.
   handoff 생성 **후에** 한다 — 결정 기록이 바뀌면 같은 run 의 fingerprint 가 무효가 되기 때문이다.
2. `tdd-handoff.yaml` 을 읽고 요약해 제시한다.
   - 대상 작업 항목과 route
   - 승인된 명세 경로
   - test obligation 목록 — 구현이 반드시 만족해야 하는 항목
   - `acceptance_coverage` — 수용 기준별로 증명하는 obligation
   - non-blocking note, decision log 경로(있으면)

## 6. 다음 행동 안내

`.spec-cycle/config.yaml` 의 `execution.adapter` 를 읽어 다음 커맨드를 한 줄로 안내한다. 대신 실행하지 않는다.

- `superpowers` 또는 `inline` — `/spec-cycle:implement <id>`
- `command` — 설정된 `execution.command` 를 작업 항목의 외부 id 로 호출하라고 안내한다. 외부 id 는
  `external_ref`(예: `taskmaster:master:6` → `6`)에서 얻고, 없으면 작업 항목 id 를 쓴다. 안내에
  "brief를 먼저 읽을 것"을 붙인다. brief(`spec-brief.md`)는 `/spec-cycle:implement <id>` 가 만든다.

## 최종 보고

한 화면에 담긴다.

- `run_id` 와 `run_dir`
- 최종 판정과 비평 패스 수, revision 수
- 작업 항목별 route 와 근거 한 줄
- 사람이 답한 결정(권장안 채택 여부 포함)과 승격된 결정 기록 경로
- `warnings` 에서 사람이 확인해 준 사항, 처리한 `notices`
- 다음 행동 한 줄(어댑터별 커맨드)
