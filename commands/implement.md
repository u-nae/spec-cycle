---
description: "READY handoff → 명세 브리프 → 실행 어댑터(superpowers / inline / command) 인계"
argument-hint: "<work-item-id>"
disable-model-invocation: true
---

# 구현 인계

READY handoff 가 있는 작업 항목 하나를 설정된 실행 어댑터에 넘긴다. 사람이 이 커맨드를 직접 호출한 것
자체가 구현을 시작하겠다는 결정이다.

`$ARGUMENTS` — 대상 작업 항목 id (예: `W06`). 생략 시 사람에게 묻는다. 추측하지 않는다.

## 이 커맨드가 하지 않는 것

- 코드나 테스트를 쓰지 않는다. `inline` 어댑터에서도 사람이 시작을 지시한 뒤에만 쓴다.
- 작업 항목 상태에 `done` 을 쓰지 않는다. `done` 은 `/spec-cycle:verify` 만 쓴다.
- 다른 커맨드를 사람 대신 실행하지 않는다(`execution.command` 포함).
- 무엇도 승인하지 않는다. handoff 의 승인은 비평 게이트가 끝낸 일이다.

## 플러그인 경로

이하 `PLUGIN_ROOT` 는 `${CLAUDE_PLUGIN_ROOT}` 다. 이 변수가 그대로 문자열로 남아 확장되지
않았다면, `scripts/spec-cycle.mjs` 를 포함한 플러그인 디렉터리를 찾아 그 절대경로를 쓴다.

## 1. handoff 해석

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs resolve-handoff --task <id>
```

출력 Resolution 의 `usable`, `errors`, `warnings`, `run_dir`, `handoff`, `brief`, `work_item_status` 를 읽는다.

- `usable: false` (종료 코드 1) — `errors` 를 **그대로 전달하고 멈춘다.** 우회하지 않는다.
- `warnings` — 최종 보고에 싣는다. `work_item_status` 가 `done` 이면 `AskUserQuestion` 으로 계속할지 확인한다.
  사람이 계속하기로 하면 3단계(상태 전이)를 건너뛰고 상태는 `done` 으로 둔다(`done -> in-progress` 는
  허용되지 않으며, 이후 verify 의 `--mark-done` 은 상태를 바꾸지 않는다).

## 2. 브리프 생성

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs render-brief --handoff <handoff> --out <run_dir>/spec-brief.md
```

기존 brief 와 내용이 다르면 스크립트가 덮어쓰지 않고 오류를 낸다. 그 오류를 전달하고 멈춘다.

## 3. 상태 전이

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs set-status --task <id> --status in-progress
```

이미 `in-progress` 라서 변경이 없다는 응답은 무시한다. 그 밖의 오류는 전달하고 멈춘다.

## 4. 어댑터 분기

`.spec-cycle/config.yaml` 의 `execution.adapter` 를 읽는다.

### superpowers

1. `node PLUGIN_ROOT/scripts/spec-cycle.mjs detect` 를 실행한다. `superpowers: false` 면 이 절을 건너뛰고
   **inline** 절로 내려간다. 최종 보고의 **첫 줄**에 "superpowers 미설치로 inline 어댑터로 내려갔다"고 적는다.
   config 는 바꾸지 않는다.
2. `Skill` 도구로 `superpowers:writing-plans` 를 호출한다. spec 은 `<run_dir>/spec-brief.md` 다. 호출할 때
   다음 세 규약을 문장 그대로 전달한다.
   - "brainstorming은 명세 게이트가 대신했다. READY handoff가 승인된 spec이다. brainstorming을 호출하지 않는다."
   - "plan의 모든 task는 `**Obligations:**` 줄에 그 task가 증명하는 `obligation_id`를 나열한다."
   - "테스트 이름/태그에 `obligation_id`를 넣는다."
3. plan 이 저장되면 검사한다. `<plan>` 은 `superpowers:writing-plans` 가 저장했다고 보고한 파일 경로다.
   경로를 보고하지 않았으면 `.spec-cycle/config.yaml` 의 `execution.plan_dir` 아래에서 가장 최근에 수정된
   `.md` 파일을 쓴다.

   ```
   node PLUGIN_ROOT/scripts/spec-cycle.mjs check-plan --plan <plan> --handoff <handoff>
   ```

   출력의 `missing` 이 비어 있지 않으면(종료 코드 1, `obligation <id> is not assigned in the plan`) plan 을
   보완하게 하고 다시 검사한다. `missing` 이 빌 때까지 실행 단계로 넘기지 않는다.
4. 실행 방식 선택은 superpowers의 질문에 사람이 답한다. 이 커맨드는 묻지 않는다. 실행은 superpowers 가 고른
   스킬(`superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`)이 맡는다.
5. plan 실행이 끝나면 `superpowers:finishing-a-development-branch` **전에** `/spec-cycle:verify <id>` 를
   먼저 돌리라고 안내한다.

### inline

1. `<run_dir>/spec-brief.md` 와 `tdd-handoff.yaml` 을 읽고 요약해 제시한다.
   - 대상 작업 항목과 route
   - 승인된 명세 경로
   - test obligation 목록 — 구현이 반드시 만족해야 하는 항목
   - `acceptance_coverage` — 수용 기준별로 증명하는 obligation
   - non-blocking note, decision log 경로(있으면)
2. 사람이 시작하라고 지시하면 같은 세션에서 obligation 을 하나씩 실패하는 테스트로 옮기는 TDD 를 한다.
   `superpowers:test-driven-development` 가 있으면 `Skill` 도구로 그 스킬을 쓴다. 테스트 이름이나 태그에
   `obligation_id` 를 남겨 추적성을 유지한다. 시작 시점은 사람이 정한다.
3. 끝나면 `/spec-cycle:verify <id>` 를 돌리라고 안내한다.

### command

`execution.command` 를 작업 항목의 외부 id 로 호출하라고 사람에게 한 줄로 안내한다. 외부 id 는 `external_ref`
(예: `taskmaster:master:6` → `6`)에서 얻고, 없으면 작업 항목 id 를 쓴다. 호출 전에 `<run_dir>/spec-brief.md`
를 읽게 한다. 이 플러그인은 그 커맨드를 실행하지 않는다. 끝나면 `/spec-cycle:verify <id>` 를 안내한다.

## 최종 보고

한 화면에 담긴다. superpowers 에서 inline 으로 내려갔다면 **첫 줄**에 그 사실을 적는다.

- 대상 작업 항목, `run_dir`, brief 경로, 상태(`in-progress`)
- `resolve-handoff` 의 warnings
- 선택된 어댑터와 진행 결과(superpowers: plan 경로와 `check-plan` 결과)
- 다음 행동 한 줄(`/spec-cycle:verify <id>` 또는 어댑터별 호출)
