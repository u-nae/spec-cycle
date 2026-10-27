# 검증 결과

2026-10-27 기준. Claude Code 2.1.311, Node.js v22.19.0, spec-cycle 0.4.0에서 아래 명령을 실제로 실행해 얻은 출력이다.

## 실행한 검사

| 검사 | 결과 |
| --- | --- |
| `claude plugin validate . --strict` | 통과 (`Validation passed`) |
| `claude --plugin-dir . plugin details spec-cycle` | 0.4.0 로드. `Skills (7)` 로 7개(implement, init, run, specification-author, specification-critic, verify, work-items)를 나열한다 — 커맨드 4개(implement, init, run, verify)와 스킬 3개를 합친 수이며 커맨드 절은 따로 없다. 에이전트 1개(specification-critic-agent), 훅·MCP·LSP 0개. 상시 토큰 비용 약 847 tok. 구성 요소별 `disable-model-invocation` 표시는 없다 |
| `claude --plugin-dir . -p "…Skill 도구로 부를 수 있는 spec-cycle: 항목을 나열…"` | 커맨드 4개에 `disable-model-invocation: true` 를 단 뒤 `NONE`. 같은 질문을 플래그 없는 커맨드로 돌린 대조 실행은 `spec-cycle:implement`, `init`, `run`, `verify` 를 나열했다. 모델이 부를 수 있는 진입점은 없다 |
| `npm test` | 175개 중 175 통과, 0 실패 |
| `npm run validate:fixtures` | 7/7 fixture PASS (`taskmaster`만 `taskmaster_import: PASS`, 나머지는 `null`) |
| `npm run metrics` | 7개 fixture 전체 완료 (runs 7, tasks 7, traceability_completeness 1, validation_failure_rate 0) |
| `npm run validate` | 위 plugin validate, plugin details, `npm test`를 연속 실행해 모두 통과 |

`npm run metrics`의 출력(`reports/fixture-metrics.yaml`)은 git에서 제외된다.

## 테스트가 다루는 범위

- config: init, 덮어쓰기 거부, 설정 누락 안내, 스키마 버전
- detect/glob: 입력 탐지, 글롭 패턴 해석
- work-items: 알림과 경고 구분, 하위 작업 평탄화, id 검증, 인수 기준 coverage
- intake-taskmaster: tasks.json 수입(생성·갱신·deferred), 태그 해석, 상태 매핑, 하위 작업 id
- decision: 결정표 평가, hit policy, 공백·중복 검출, 벡터 산출
- core/table-v1: 매니페스트·비평 보고 검증, run-id 무효화, 근거 있는 질문, fixture 검증, 지표
- handoff: TDD handoff 생성과 인수 기준 coverage
- brief: 구현 브리프 생성
- verify: 의무 대비 테스트 존재 확인
- status: `status --json` 스키마, `--write` 원자 쓰기, 상태 변경 서브커맨드의 자동 갱신, 쓰기 실패 시 종료 코드 보존, 미응답 질문 선별, handoff 무효화 반영, fixture 7종 골든(`tests/golden/status/`)

## 의미 fixture

`validate-fixtures`는 각 fixture의 경로·판정을 `expected.yaml`과 비교한다. `taskmaster`는 추가로 `input/tasks.json`을 임시 디렉터리에서 다시 수입해 `input/work-items.yaml`의 id·external_ref·title과 일치하는지 확인한다.

| Fixture | 경로 | 비평 판정 | 목적 |
| --- | --- | --- | --- |
| pass | PASS | READY | 불필요한 형식화 회피 |
| gherkin | GHERKIN | READY | 시간 경계, 결정 기록, 인수 기준 coverage |
| dmn | DMN | READY | hit policy, 공백과 중복 |
| both | BOTH | READY | 어휘 연결, 인수 기준 2개 |
| needs-human | GHERKIN | NEEDS_HUMAN | 제안이 달린 차단 질문 |
| revise | GHERKIN | REVISE | 비평의 누락 검출과 제한된 수정 |
| taskmaster | GHERKIN | READY | Task Master import feeds the gate |

## 실사용 사이클 (2026-10-28 추가)

위 검사는 2026-10-27에 다시 돌린 것이다. 2026-10-13 이후 두 프로젝트에서 `run → implement → verify` 전체 사이클을 실제로 7회 돌렸다. 아래 수치는 각 run의 `tdd-handoff.yaml`과 `verify-*.yaml`/`verification.yaml`에서 그대로 집계했다.

| 프로젝트 | 실행 어댑터 | 작업 항목 | 날짜 | 테스트 의무 | 미커버 |
| --- | --- | --- | --- | --- | --- |
| fianchetto (Swift macOS 앱) | superpowers | W20 | 2026-10-14 | 29 | 0 |
| fianchetto | superpowers | W21 | 2026-10-16 | 35 | 0 |
| fianchetto | superpowers | W22 | 2026-10-19 | 47 | 0 |
| 외주 커머스·WMS 백엔드 (Spring) | inline | CP03 | 2026-10-18 | 31 | 0 |
| 외주 커머스·WMS 백엔드 | inline | CP04 | 2026-10-18 | 31 | 0 |
| 외주 커머스·WMS 백엔드 | inline | CP05 | 2026-10-19 | 16 | 0 |
| 외주 커머스·WMS 백엔드 | inline | CP06 | 2026-10-26 | 33 | 0 |

- 합계: 7회, 테스트 의무 222개, 미커버 0. 작업 항목 상태는 모두 `verify` 통과 뒤에만 `done`이 됐다.
- 그 이전 run(fianchetto W01~W19·W28·W29, 외주 백엔드 CP02)은 전신인 fianchetto-spec-gate로 돌렸다. 게이트(작성·비평·handoff)까지만 거쳤고, implement·verify 단계는 없었다.
- 실사용이 도구를 고친 사례: fianchetto 결정표 비평에서 "평가기의 공백 0은 선언된 입력 안에서만 완전하다"는 지적이 나왔다. 이 지적은 작성 규칙("읽어서 얻는 입력은 읽기 실패 값과 그 규칙을 선언한다", 2026-10-14)으로 들어갔다.

## 검증하지 않은 것

- `command` 실행 어댑터(Task Master 연동)로는 아직 실사용 사이클을 돌리지 않았다. 위 7회는 `superpowers`와 `inline` 어댑터다.
- 실제 Task Master 프로젝트에서의 수입은 0건이다. 수입은 fixture의 tasks.json으로만 확인했다.
- 커버리지 검사는 존재 확인이며 테스트의 의미적 충분성은 보증하지 않는다.
- fixture 결과와 지표는 표본일 뿐이며 실제 운영 가치의 증거가 아니다.
