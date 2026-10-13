---
description: "프로젝트 초기화 — 환경 감지 → .spec-cycle/config.yaml 생성 (기존 .spec-gate 설정 채택 지원)"
argument-hint: "[--adopt path] [--baseline a,b]"
disable-model-invocation: true
---

# 프로젝트 초기화

프로젝트의 환경을 감지해 `.spec-cycle/config.yaml` 을 만든다. 프로젝트당 한 번 실행한다.

`$ARGUMENTS` — 선택적 `--adopt <path>`, `--baseline <a,b>` 등 `init` 플래그. 주어진 값은 감지 결과보다 우선한다.

## 이 커맨드가 하지 않는 것

- 기존 `.spec-cycle/config.yaml` 을 덮어쓰지 않는다.
- 기준 문서, 작업 항목, 결정 기록의 내용을 만들거나 고치지 않는다. 빈 `docs/work-items.yaml` 과 결정 기록
  디렉터리를 만드는 것은 `init` 스크립트의 일이다.
- 다른 커맨드를 대신 실행하지 않는다.
- 감지 결과가 모호한데 추측으로 확정하지 않는다.

## 플러그인 경로

이하 `PLUGIN_ROOT` 는 `${CLAUDE_PLUGIN_ROOT}` 다. 이 변수가 그대로 문자열로 남아 확장되지
않았다면, `scripts/spec-cycle.mjs` 를 포함한 플러그인 디렉터리를 찾아 그 절대경로를 쓴다.

## 1. 감지

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs detect [--project <dir>]
```

출력 YAML 의 `task_master`, `superpowers`, `baseline_candidates`, `decision_records_candidate`,
`test_glob_candidates`, `existing_config`, `suggested` 를 읽는다. 직접 파일을 탐색해 이를 대체하지 않는다.

- `existing_config.spec_cycle` 이 있으면 **여기서 멈추고** 기존 설정 경로를 보고한다. 덮어쓰지 않는다.
- `existing_config.spec_gate` 가 있으면 `--adopt <그 경로>` 를 제안한다. 채택하면 기존 값을 복사하고
  `run_root` 는 원래 값을 유지한다(run 디렉터리를 옮기지 않는다).

## 2. 선택

`suggested` 와 후보에서 기준 문서(`--baseline`), 결정 기록 디렉터리, `intake`, `execution`, 테스트 glob 을 정한다.

- 후보가 하나뿐이고 `suggested` 와 일치하면 묻지 않고 채택한다.
- 후보가 여럿이거나, `suggested` 가 프로젝트가 분명히 필요로 하는 것과 다르면 `AskUserQuestion` 으로 묻는다.
  권장 선택지를 첫 번째에 두고 라벨 끝에 "(권장)" 을 붙인다. 선택지마다 영향을 설명에 적는다.
- `execution` 이 `command` 면 슬래시 커맨드(`--command`)를 반드시 확인한다.
- 질문은 작은 묶음으로 한다. 답을 추론하지 않는다.

## 3. 실행

```
node PLUGIN_ROOT/scripts/spec-cycle.mjs init (--baseline <doc>[,<doc>...] | --adopt <path>) \
  [--decision-records <dir>] [--work-items <file>] [--run-root <dir>] \
  [--intake <native|taskmaster>] [--execution <superpowers|inline|command>] \
  [--command <slash>] [--test-globs <a,b>] [--project <dir>]
```

스크립트가 오류를 내면 출력을 그대로 전달하고 멈춘다.

## 최종 보고

한 화면에 담긴다.

| 항목 | 값 |
| --- | --- |
| 생성된 파일 | 경로 목록 |
| 기준 문서 | 선택된 문서 |
| intake 어댑터 | `native` / `taskmaster` |
| execution 어댑터 | `superpowers` / `inline` / `command` (+ 커맨드) |
| 테스트 glob | 선택된 glob |

사람이 직접 고른 항목과 `suggested` 를 따른 항목을 구분해 한 줄로 덧붙인다. 다음 행동 한 줄:
`/spec-cycle:work-items` (intake 가 `taskmaster` 면 먼저 `import-taskmaster` 안내).
