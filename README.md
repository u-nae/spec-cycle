# spec-cycle

기준 문서에서 뽑은 작업 항목이 TDD에 들어가기 전에 거치는 개인용 명세 게이트 Claude Code 플러그인입니다.

```text
기준 문서(PRD 등) + 결정 기록
  → work-items      작업 항목 목록 도출·갱신
  → author          라우팅, Gherkin/결정표 작성, 정책 질문(권장안 포함)
  → critic          독립 컨텍스트 비평
  → 사람의 답변과 제한된 수정 (최대 2회)
  → READY 전용 TDD handoff (수용 기준 커버리지 포함)
  → 결정 기록 승격 → TDD
```

요구사항을 구현하거나 테스트를 쓰는 도구가 아닙니다. 작업 항목마다 형식 명세가 필요한지 판단하고,
독립 비평을 통과한 결과만 TDD로 넘기는 품질 게이트입니다.

## 핵심 설계

| 영역 | 방식 |
| --- | --- |
| 입력 | `.spec-cycle/config.yaml` 에 선언한 **기준 문서 묶음 + 결정 기록 디렉터리**와 `docs/work-items.yaml`. 각각 fingerprint를 남겨 바뀌면 이전 run을 무효로 처리 |
| 작업 항목 | `work-items` 스킬이 기준 문서에서 도출. 항목마다 근거 위치(`source_refs`)와 수용 기준(`acceptance_refs`) |
| 정책 질문 | **권장안(`recommended_default`)과 근거(`recommendation_rationale`) 필수.** 선택지마다 영향(`detail`) 필수. 검증기가 강제 |
| 결정 로그 | 원래 질문·권장안·답변·채택 여부(`followed_recommendation`)를 보존. READY 후 결정 기록으로 승격 |
| 추적성 | 작업 항목 ↔ 명세 ↔ test obligation, 그리고 **수용 기준이 모두 obligation으로 커버되는지** 검증. handoff에 `acceptance_coverage` |
| 비평 관점 | 명세 품질에 더해 기준 문서의 불변식 반영(`invariant-gap`), 결정 기록 준수, 실패·저장 실패 경로 |
| TDD 인계 | 특정 테스트 프레임워크에 묶지 않음. 테스트 이름이나 태그에 `obligation_id`를 남겨 추적 |

게이트의 성질은 다음으로 지킵니다: 사람만 호출(`disable-model-invocation`), 작성자와 비평자 컨텍스트 분리,
스크립트가 판정 규칙·revision 한도·READY 전용 handoff를 강제.

## 구성 요소

| 이름 | 종류 | 역할 |
| --- | --- | --- |
| `/spec-cycle:run` | 커맨드 | 권장 진입점. 입력 해석 → 작성 → 독립 비평 → 판정 처리 → handoff → 결정 기록 승격 |
| `work-items` | 스킬 | 기준 문서·결정 기록에서 `docs/work-items.yaml` 도출·갱신 |
| `specification-author` | 스킬 | 라우팅(PASS/GHERKIN/DMN/BOTH)과 명세 작성, 수정, 답변 반영 |
| `specification-critic` | 스킬 (`context: fork`) | 사람이 직접 부르는 독립 비평 |
| `specification-critic-agent` | 에이전트 | `run` 커맨드가 부르는 독립 비평 |
| `scripts/spec-cycle.mjs` | 스크립트 | `init`, `resolve-inputs`, `normalize`, `fingerprint`, `validate-*`, `build-handoff` |

세부 계약은 [`references/contracts.md`](references/contracts.md), 실행 흐름과 결정 기록 형식은
[`docs/integration.md`](docs/integration.md)에 있습니다.

## 요구 환경

- Claude Code 2.1.231 이상 (2.1.286에서 검증)
- Node.js 20 이상
- 런타임 의존성(`yaml`, `@cucumber/gherkin`)은 `node_modules/` 째로 저장소에 포함합니다. 플러그인 설치는
  파일 복사만 하고 `npm install` 을 실행하지 않기 때문입니다. `npm` 은 플러그인을 고칠 때만 필요합니다.

## 설치 (개인 프로필)

```bash
claude plugin marketplace add /Users/unae/Documents/u.naee/spec-cycle
claude plugin install spec-cycle@spec-cycle
```

설치본은 `plugin.json` 의 `version` 기준 **스냅숏 복사본**입니다. 소스를 고친 뒤에는 버전을 올려
`claude plugin update spec-cycle@spec-cycle` 하거나, uninstall 후 다시 install 합니다.
어느 쪽이든 새 세션에서 반영됩니다. 플러그인을 활발히 고치는 중이면 `claude --plugin-dir <경로>` 로
소스 디렉터리를 직접 붙이는 편이 낫습니다.

## 프로젝트에서 쓰기

### 1. 초기화 (프로젝트당 1회)

```bash
node <plugin>/scripts/spec-cycle.mjs init \
  --baseline docs/PRD.md,docs/TECH_STACK.md \
  --decision-records docs/decisions \
  --work-items docs/work-items.yaml
```

`.spec-cycle/config.yaml`, 빈 `docs/work-items.yaml`, `docs/decisions/` 를 만듭니다. 기존 설정은 덮어쓰지 않습니다.

### 2. 작업 항목 도출

```text
/spec-cycle:work-items
```

기준 문서의 구현 순서·범위·수용 기준을 읽고 작업 항목(`W01`, `W02`, …)을 만듭니다. 항목마다 근거
위치(`source_refs`)와 책임지는 수용 기준(`acceptance_refs`)을 답니다.

### 3. 게이트 실행

```text
/spec-cycle:run W05
```

- 정책 모호성이 나오면 에이전트가 먼저 판단해 **권장안을 붙여** 질문합니다. 답은 결정 로그에 남고,
  READY 후 `docs/decisions/` 의 결정 기록으로 옮겨집니다.
- READY가 되면 `.spec-cycle/runs/<run-id>/tdd-handoff.yaml` 이 생깁니다. TDD 시작 시점은 사람이 정합니다.

### 판정

| 판정 | 의미 | 다음 단계 |
| --- | --- | --- |
| `READY` | critical/major 발견과 blocking 질문 없음 | handoff 생성 → 결정 기록 승격 → TDD |
| `REVISE` | 근거 문서만으로 고칠 수 있음 | 새 revision 작성 후 재비평 |
| `NEEDS_HUMAN` | 새 정책 결정 필요 | 권장안과 함께 질문 → 답 반영 → 재비평 |
| `BLOCKED_AT_LIMIT` | 수정 2회를 넘김 | 중단하고 남은 문제를 사람에게 보고 |

기준 문서, 결정 기록 집합, 작업 항목 목록 중 하나라도 바뀌면 그 이전에 작성한 run은 무효가 되고
새 run_id를 받습니다.

## 검증

```bash
npm test                 # 자동 테스트
npm run validate         # 플러그인 검증 + 로드 확인 + 테스트
npm run validate:fixtures
npm run metrics
```

fixture 6종(PASS, GHERKIN, DMN, BOTH, NEEDS_HUMAN, REVISE)과 dry-run 1종으로 계약을 검증합니다.
결과는 [`docs/validation-results.md`](docs/validation-results.md)에 있습니다.

## 현재 제한 사항

- 결정표는 실행 엔진이 없어 `execution_format: review-only` 입니다.
- 실제 프로젝트 적용 표본이 아직 없습니다. fixture 결과는 동작 검증일 뿐 효과의 근거가 아닙니다.
- `questions.yaml` 과 manifest 질문 사본의 동일성은 작성 규칙이며 검증기가 비교하지 않습니다.
