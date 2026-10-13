# 검증 결과

2026-10-13 기준. Claude Code 2.1.296, Node.js v22.19.0, spec-cycle 0.2.0에서 아래 명령을 실제로 실행해 얻은 출력이다.

## 실행한 검사

| 검사 | 결과 |
| --- | --- |
| `claude plugin validate . --strict` | 통과 (`Validation passed`) |
| `claude --plugin-dir . plugin details spec-cycle` | 0.2.0 로드. 스킬 7개(implement, init, run, specification-author, specification-critic, verify, work-items), 에이전트 1개(specification-critic-agent), 훅·MCP·LSP 0개. 상시 토큰 비용 약 847 tok |
| `npm test` | 131개 중 131 통과, 0 실패 |
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

## 검증하지 않은 것

- 실제 `run → implement(superpowers) → verify` 사이클은 한 번도 실행하지 않았다. 첫 실전 검증은 fianchetto W20이다(스펙 §14).
- 실제 Task Master 프로젝트에서의 수입은 0건이다. 수입은 fixture의 tasks.json으로만 확인했다.
- 커버리지 검사는 존재 확인이며 테스트의 의미적 충분성은 보증하지 않는다.
- fixture 결과와 지표는 표본일 뿐이며 실제 운영 가치의 증거가 아니다.
