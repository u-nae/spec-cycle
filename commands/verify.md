---
description: "obligation 커버리지 검증 — 테스트 파일에서 obligation_id 확인, 통과 시에만 작업 항목 done"
argument-hint: "<work-item-id>"
disable-model-invocation: true
---

# obligation 커버리지 검증

구현이 끝난 작업 항목의 test obligation 이 테스트 파일에 모두 나타나는지 확인하고, 조건을 충족할 때만
`done` 으로 바꾼다. 작업 항목이 `done` 이 되는 유일한 경로다.

`$ARGUMENTS` — 대상 작업 항목 id (예: `W06`). 생략 시 사람에게 묻는다. 추측하지 않는다.

## 이 커맨드가 하지 않는 것

- 테스트나 애플리케이션 코드를 쓰거나 고치지 않는다.
- 커버리지가 불완전하거나 테스트가 통과하지 않았는데 `done` 을 쓰지 않는다.
- 커버리지가 테스트의 정확성을 증명한다고 말하지 않는다. 커버리지는 **존재 검사**다.
- 다른 커맨드를 사람 대신 실행하지 않는다.

## 플러그인 경로

이하 `PLUGIN_ROOT` 는 `${CLAUDE_PLUGIN_ROOT}` 다. 이 변수가 그대로 문자열로 남아 확장되지
않았다면, `scripts/spec-cycle.mjs` 를 포함한 플러그인 디렉터리를 찾아 그 절대경로를 쓴다.

## 1. 커버리지 검사

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs verify-obligations --task <id>
```

스크립트가 `<run_dir>/verification.yaml` 을 쓴다. 미커버가 있으면 종료 코드 1 과
`obligation <id> is not covered by any test` 줄을 낸다. `verification.test_globs` 가 비었거나 파일이 0개라는
오류는 그대로 전달하고 설정 안내(`.spec-cycle/config.yaml` 의 `verification.test_globs`)를 덧붙여 멈춘다.

미커버가 있으면 표로 제시한다.

| obligation_id | 증명해야 할 것 |
| --- | --- |

## 2. 테스트 결과 확인

- `.spec-cycle/config.yaml` 에 `verification.test_command` 가 있으면 에이전트가 실행하고 종료 코드를 적어 둔다.
  실패하면 출력을 그대로 보고한다.
- 없으면 `AskUserQuestion` 으로 프로젝트 테스트를 돌렸고 통과했는지 사람에게 묻고 답을 적어 둔다.

## 3. 완료 처리

**미커버가 0개이고 테스트가 통과(또는 사람이 확인)했을 때만** 실행한다.

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs verify-obligations --task <id> --mark-done
```

스크립트가 미커버가 없을 때만 `done` 을 쓴다. 미커버가 있거나, 테스트가 실패했거나, 사람이 테스트를 돌리지
않았다고(`human_confirmed_tests: false`) 답했다면 `--mark-done` 을 **실행하지 않고** 상태를 그대로 둔다.

## 4. 기록

이 커맨드의 **마지막** `verify-obligations` 실행(`--mark-done` 실행, 3단계를 건너뛰었다면 1단계 실행)
**이후에** `<run_dir>/verification.yaml` 의 `test_command` 필드 바로 뒤에 `human_confirmed_tests: true` 또는
`false` 를 직접 추가한다. 에이전트가 `test_command` 를 실행했다면 `test_command` 도
`{ command: "...", exit_code: N }` 로 채운다. 이것이 유일한 수동 편집이며 반드시 마지막에 한다.
스크립트가 실행할 때마다 보고서를 새로 써서 먼저 추가한 키와 `test_command` 값을 지우기 때문이다.

## 최종 보고

한 화면에 담긴다.

- 커버리지 `n/m` 과 미커버 obligation 목록
- 테스트 결과(`test_command` 종료 코드 또는 `human_confirmed_tests`)
- `done` 을 썼는지 여부와, 쓰지 않았다면 그 이유
- `verification.yaml` 경로
- 다음 행동 한 줄: 남은 항목은 `node PLUGIN_ROOT/scripts/spec-cycle.mjs status` 로 확인
