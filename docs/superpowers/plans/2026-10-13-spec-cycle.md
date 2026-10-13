# spec-cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `fianchetto-spec-gate`의 코어를 그대로 옮긴 위에 설정 선택형 intake/execution 어댑터, 결정표 평가기(table-v1), handoff 해석·brief·plan 검사, obligation 커버리지 검증을 더한 `spec-cycle` 플러그인을 만든다.

**Architecture:** 단일 Claude Code 플러그인. `scripts/spec-cycle.mjs`는 CLI 분기만 하고 `scripts/lib/*.mjs`가 책임별 모듈이다. 코어(`lib/core.mjs`)는 기존 `spec-gate.mjs`의 이동이며 동작을 바꾸지 않는다(기존 테스트 43개 유지). 모든 판정·상태 전이·커버리지는 스크립트가 강제하고, 커맨드·스킬은 그 스크립트를 순서대로 부른다.

**Tech Stack:** Node.js ≥ 20.11 (ESM, `node --test`, `import.meta.dirname`), `yaml` 2.9.0, `@cucumber/gherkin` 42.0.1 (둘 다 `node_modules/` 동봉), Claude Code plugin (commands / skills / agents), superpowers 6.4.x를 이름으로 호출.

**Spec:** `docs/superpowers/specs/2026-10-13-spec-cycle-design.md` — 각 task의 "스펙" 표기는 그 문서의 절 번호다.

## Global Constraints

- 저장소: `/Users/unae/Documents/u.naee/spec-cycle` (origin `https://github.com/u-nae/spec-cycle.git`, 기본 브랜치 `main`). 코어 원본: `/Users/unae/Documents/u.naee/fianchetto-spec-gate` (읽기만, 수정 금지). `stemus/ps`와 `fianchetto` 저장소도 수정 금지.
- 런타임 의존성 추가 금지. `yaml`과 `@cucumber/gherkin`(+`@cucumber/messages`)만 쓰고 `node_modules/`를 커밋한다(플러그인 설치는 `npm install`을 실행하지 않음).
- 스키마 버전은 스펙 그대로: config `"1.1"`(1.0 읽기 호환), work-items `"1.0"`, 결정표 `"1.0"` + `execution_format: table-v1`, 벡터 `"1.0"`, handoff `"1.1"`(1.0 읽기 호환), verification `"1.0"`.
- 모든 스킬 frontmatter에 `disable-model-invocation: true`. critic은 `context: fork`(스킬) 또는 서브에이전트. hook 없음.
- 산출물 경로는 저장소 상대 경로. 기본 config `.spec-cycle/config.yaml`, 기본 run root `.spec-cycle/runs`.
- 커맨드·README·docs는 한국어, 스킬·references·에이전트는 영어. 코드 식별자·커밋 메시지는 영어.
- 테스트: 임시 디렉터리를 만들고 `test.after`에서 지운다. `claude`, `task-master`, `git push` 같은 실제 CLI를 호출하지 않는다(`git` 로컬 명령은 기존 테스트가 쓰므로 허용). sleep·무작위 데이터 금지.
- 상태 전이는 `set-status`로만: `pending→in-progress`, `in-progress→done`, `pending→done`. 그 외 오류.
- 커밋 메시지: 명령형 제목(대문자 시작, 마침표 없음, ≤72자), 본문은 왜를 쓰고 72자 줄바꿈, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 각 task 끝의 검증 명령: `npm test`가 전부 통과해야 커밋한다.

## Review Focus

1. **접두어가 겹치는 obligation id** — `W06-R1`을 찾을 때 `W06-R10`이 매칭되면 안 된다. 리터럴 매칭은 id 뒤에 `[A-Za-z0-9_-]`가 오지 않는 경우만 인정한다. (Task 10 테스트)
2. **Task Master id 타입 혼재** — `tasks.json`의 `id`는 숫자, `dependencies`는 `"6.1"` 문자열, 하위 task id는 숫자 1·2·3이다. 전부 문자열로 정규화한 뒤 `T` 접두어를 붙여야 한다. (Task 6 테스트)
3. **YAML이 boolean으로 읽는 셀** — `allowed_values: [true, false]`와 `when: {is_today: true}`는 boolean으로 파싱된다. 평가기는 모든 값을 `String()`으로 키 잡아 비교해야 한다. (Task 7 테스트)
4. **handoff 1.0 읽기** — fianchetto의 기존 run 22개는 `schema_version: "1.0"`이고 `decision_vectors`가 없다. `resolve-handoff`·`render-brief`·`verify-obligations`는 이것을 오류 없이 읽어야 한다. (Task 8·9·10 테스트)
5. **한국어 값의 결정론** — allowed_values·제목·시나리오 이름에 한국어가 있을 때 벡터 파일과 brief가 두 번 렌더해도 바이트가 같아야 한다. (Task 7·9 테스트)

---

## 파일 구조

| 경로 | 책임 | 생성/수정 task |
| --- | --- | --- |
| `scripts/spec-cycle.mjs` | CLI 진입점. `parseArgs` → 서브커맨드 분기, 오류 출력 | 1, 2, 이후 각 task가 case 추가 |
| `scripts/lib/core.mjs` | 기존 spec-gate 로직(resolve/normalize/validate-*/handoff/fixtures/metrics) | 2 (이동), 7b (table-v1 통합) |
| `scripts/lib/config.mjs` | config 1.0/1.1 로드·검증, `init` 옵션(`--adopt` 포함) | 3 |
| `scripts/lib/detect.mjs` | 환경 감지(주입 가능한 실행기) | 4 |
| `scripts/lib/work-items.mjs` | `set-status`(주석 보존), 작업 항목 정의 필드 비교 | 5, 8 |
| `scripts/lib/intake-taskmaster.mjs` | `import-taskmaster` | 6 |
| `scripts/lib/decision.mjs` | table-v1 평가기, `check-decision`, `decision-vectors` | 7a |
| `scripts/lib/handoff.mjs` | `resolve-handoff` | 8 |
| `scripts/lib/brief.mjs` | `render-brief`, `check-plan` | 9 |
| `scripts/lib/verify.mjs` | `verify-obligations`, `status` | 10 |
| `tests/helpers.mjs` | `run`, `temporaryDirectory`, `workItemProject`, YAML 헬퍼 | 2 |
| `tests/<module>.test.mjs` | 모듈별 테스트 | 각 task |
| `commands/{init,run,implement,verify}.md`, `skills/*`, `agents/*`, `references/*`, `README.md`, `docs/*` | 사람·에이전트 대면 문서 | 1 (이름 치환), 6·7b (어댑터·table-v1 규칙), 11 (신규 커맨드·README) |
| `fixtures/cases/*`, `fixtures/dry-run` | 계약 fixture | 1 (복사), 7b (dmn·both → table-v1), 12 (taskmaster) |

---

### Task 1: 코어 복사와 이름 치환

**Files:**
- Create: 플러그인 전체 (`fianchetto-spec-gate`에서 복사; `.git/`, `reports/`, `.test-output/`, `.DS_Store` 제외)
- Modify: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `scripts/spec-cycle.mjs`(이름 변경 후), `tests/core.test.mjs`(이름 변경 후), `commands/run.md`, `skills/*/SKILL.md`, `agents/specification-critic-agent.md`, `references/*.md`, `docs/*.md`, `README.md`
- Test: `tests/core.test.mjs` (기존 43개)

**Interfaces:**
- Produces: CLI `node scripts/spec-cycle.mjs <command>`; 상수 `DEFAULT_CONFIG = '.spec-cycle/config.yaml'`, `DEFAULT_RUN_ROOT = '.spec-cycle/runs'`.

- [ ] **Step 1: 복사**

```bash
cd /Users/unae/Documents/u.naee/spec-cycle
rsync -a --exclude .git --exclude reports --exclude .test-output --exclude .DS_Store \
  /Users/unae/Documents/u.naee/fianchetto-spec-gate/ ./
git mv scripts/spec-gate.mjs scripts/spec-cycle.mjs 2>/dev/null || mv scripts/spec-gate.mjs scripts/spec-cycle.mjs
mv tests/spec-gate.test.mjs tests/core.test.mjs
```

- [ ] **Step 2: 기존 테스트가 이름 변경으로 실패하는 것을 확인**

Run: `npm test`
Expected: FAIL — `tests/core.test.mjs`의 `cli` 경로가 `scripts/spec-gate.mjs`를 가리켜 spawn 실패.

- [ ] **Step 3: 이름 치환**

전체 트리(`node_modules/` 제외)에서 다음을 치환한다.

| 찾기 | 바꾸기 |
| --- | --- |
| `fianchetto-spec-gate` | `spec-cycle` |
| `spec-gate.mjs` | `spec-cycle.mjs` |
| `.spec-gate/config.yaml` | `.spec-cycle/config.yaml` |
| `.spec-gate/runs` | `.spec-cycle/runs` |
| `Fianchetto Spec Gate`, `fianchetto-spec-gate-validation` | `spec-cycle`, `spec-cycle-validation` |

`plugin.json`: `"name": "spec-cycle"`, `"version": "0.2.0"`, description은 "Specification gate cycle: config-selected intake (native/Task Master) and execution (superpowers/inline/command) adapters around an independent-critic gate, with decision-table evaluation and obligation coverage verification". `marketplace.json`도 같은 이름·설명. `package.json`의 `validate` 스크립트는 `claude plugin validate . --strict && claude --plugin-dir . plugin details spec-cycle && npm test`. README 본문의 fianchetto 고유 서술(설치 경로 등)은 Task 11에서 다시 쓰므로 이 단계에서는 이름만 바꾼다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: `# pass 43`, `# fail 0`

- [ ] **Step 5: 플러그인 검증**

Run: `claude plugin validate . --strict && claude --plugin-dir . plugin details spec-cycle`
Expected: validate 통과, details에 `spec-cycle` 0.2.0, skills 4개(run, specification-author, specification-critic, work-items), agent 1개.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Import fianchetto-spec-gate core as spec-cycle

Copy the gate core, vendored dependencies, fixtures and tests
unchanged except for the plugin name, script name and default
config paths, so later tasks can be reviewed as deltas against a
known-passing baseline (43 tests)."
```

---

### Task 2: CLI와 라이브러리 분리, 테스트 헬퍼 추출

**Files:**
- Create: `scripts/lib/core.mjs`, `tests/helpers.mjs`
- Modify: `scripts/spec-cycle.mjs` (분기만 남김), `tests/core.test.mjs` (헬퍼 import)
- Test: `tests/core.test.mjs`

**Interfaces:**
- Produces (`lib/core.mjs` named exports): `ValidationError`, `parseArgs(argv) → {command, args}`, `required(args, key)`, `optional(args, key)`, `readYaml(file)`, `writeYaml(file, value)`, `sha256File(file)`, `isBlank(value)`, `asArray(value)`, `isObject(value)`, `portablePath(file, projectRoot)`, `assertPortable(value, label, errors)`, `findProjectRoot(artifactFile, sourcePath)`, `resolveArtifact(projectRoot, artifactPath)`, `walkFiles(root, predicate)`, `decisionRecordFiles(projectRoot, dir)`, `sourceSnapshot(projectRoot, config)`, `readWorkItems(file)`, `flattenWorkItems(items, source) → {tasks, warnings}`, `selectTasks(tasks, id)`, `authorReviewFingerprint(manifestFile)`, `validateDecision(file, taskId) → string[]`, `validateAuthorFile(manifestFile) → Promise<{manifest, projectRoot}>`, `validateCriticFile(report, manifest)`, `validateDecisionLogFile(log, manifest)`, `buildHandoff(args)`, `initCommand(args)`, `resolveInputsCommand(args)`, `normalizeCommand(args)`, `validateFixtures(root)`, `metricsCommand(args)`, `relativeFromProject(projectRoot, file)`, 상수 `DEFAULT_CONFIG`, `DEFAULT_RUN_ROOT`, `ITEM_STATUSES`, `ITEM_ID`.
- Produces (`tests/helpers.mjs` named exports): `pluginRoot`, `cli`, `fixtures`, `run(args, cwd?)`, `temporaryDirectory(name)`, `temporaryFixture(name)`, `readYaml`, `writeYaml`, `editYaml`, `refreshFingerprint(project, manifest?, report?)`, `workItemProject(items, opts?)`, `defaultItems`, `registerCleanup()` — `registerCleanup`은 각 테스트 파일이 한 번 호출해 `test.after` 정리를 등록한다.

- [ ] **Step 1: 헬퍼 추출**

`tests/core.test.mjs` 1~81행의 헬퍼를 `tests/helpers.mjs`로 옮기고 named export한다. `temporaryDirectories` 배열은 모듈 내부에 두고 `registerCleanup()`이 `test.after`를 등록한다. `tests/core.test.mjs`는 `import { ... } from './helpers.mjs'`와 `registerCleanup()` 한 줄로 바꾼다.

- [ ] **Step 2: 라이브러리 분리**

`scripts/spec-cycle.mjs`의 `main()`·`usage()`·shebang·`main().catch` 외 전부를 `scripts/lib/core.mjs`로 옮기고 위 목록을 export한다. `spec-cycle.mjs`는 `import * as core from './lib/core.mjs'`로 분기한다. `loadConfig`는 이 단계에서는 core에 남긴다(Task 3이 옮김).

- [ ] **Step 3: 동봉 의존성 누락 메시지 (스펙 §11)**

`spec-cycle.mjs`는 `lib/core.mjs`를 `await import()`로 읽고, `error.code === 'ERR_MODULE_NOT_FOUND'`이며 메시지에 `'yaml'` 또는 `'@cucumber'`가 포함되면 `"spec-cycle: bundled node_modules are missing from this plugin install; reinstall the plugin or run npm install in the plugin directory"`를 stderr에 쓰고 종료 코드 1로 끝낸다. 테스트(`tests/core.test.mjs` 추가): 임시 디렉터리에 `scripts/`만 복사하고 `node_modules` 없이 실행 → stderr에 위 문장, status 1.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: `# pass 44`, `# fail 0`. 기존 43개의 단언은 바뀌지 않았다.

- [ ] **Step 5: 모듈이 직접 import 가능한지 확인**

Run: `node -e "import('./scripts/lib/core.mjs').then(m => console.log(typeof m.validateDecision, m.DEFAULT_CONFIG))"`
Expected: `function .spec-cycle/config.yaml`

- [ ] **Step 6: Commit**

```bash
git add scripts tests
git commit -m "Split CLI dispatch from gate library and share test helpers

Later modules (config, decision, intake, brief, verify) import the
core functions directly and need the same temporary-project helpers,
so both move out of the single script and single test file. No
behaviour changes."
```

---

### Task 3: config 1.1과 `init --adopt`

**Files:**
- Create: `scripts/lib/config.mjs`, `tests/config.test.mjs`
- Modify: `scripts/lib/core.mjs` (`loadConfig` 제거 후 import; `initCommand` 이동), `scripts/spec-cycle.mjs`
- Test: `tests/config.test.mjs`

**Interfaces:**
- Produces: `loadConfig(projectRoot, configArg?) → Config`:
  ```js
  // Config
  { path, baseline: string[], decision_records: string|null, work_items, run_root,
    schema_version: '1.0'|'1.1',
    intake: { adapter: 'native'|'taskmaster', taskmaster: { tasks: string, tag: string|null } },
    execution: { adapter: 'superpowers'|'inline'|'command', command: string|null, plan_dir: string },
    verification: { test_globs: string[], id_pattern: string|null, test_command: string|null } }
  ```
  1.0 파일의 기본값: `intake.adapter 'native'`, `intake.taskmaster.tasks '.taskmaster/tasks/tasks.json'`, `tag null`, `execution.adapter 'inline'`, `command null`, `plan_dir 'docs/superpowers/plans'`, `verification.test_globs []`, `id_pattern null`, `test_command null`.
- Produces: `initCommand(args)` — 기존 옵션 + `--intake <native|taskmaster>`, `--execution <superpowers|inline|command>`, `--command <slash>`, `--test-globs <a,b>`, `--adopt <path>`. `--adopt`는 지정 파일(1.0 또는 1.1)을 읽어 그 값(`baseline`, `decision_records`, `work_items`, `run_root`)을 기본으로 삼고, 명시 옵션이 덮어쓴다. 항상 1.1로 쓴다. 기존 `.spec-cycle/config.yaml`은 덮어쓰지 않는다.
- Produces: `CONFIG_ERRORS` 메시지 형식 `"<relative>: <field> must be one of a, b"`.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/config.test.mjs`)

```js
test('a 1.0 config loads with native intake, inline execution and empty test globs', ...)
  // workItemProject()로 만든 1.0 config → run(['resolve-inputs']) 성공, 그리고
  // import('../scripts/lib/config.mjs').loadConfig(project) 의 intake.adapter === 'native',
  // execution.adapter === 'inline', verification.test_globs deep-equals []
test('a 1.1 config rejects an unknown intake adapter', ...)
  // config에 intake: {adapter: 'jira'} → resolve-inputs status 1, stderr 포함 "intake.adapter must be one of native, taskmaster"
test('a 1.1 config with execution command requires execution.command', ...)
  // execution: {adapter: 'command', command: null} → stderr 포함 "execution.command is required when execution.adapter is command"
test('init writes a 1.1 config with the requested adapters', ...)
  // init --baseline docs/PRD.md --intake taskmaster --execution superpowers --test-globs "tests/**/*.mjs,src/**/*.test.ts"
  // → config.schema_version '1.1', intake.adapter 'taskmaster', verification.test_globs 길이 2
test('init --adopt copies baseline, records, work items and run root from an existing 1.0 config', ...)
  // .spec-gate/config.yaml(1.0, run_root .spec-gate/runs) 작성 → init --adopt .spec-gate/config.yaml
  // → .spec-cycle/config.yaml 생성, run_root === '.spec-gate/runs', schema_version '1.1'; .spec-gate/ 는 그대로
test('init refuses to overwrite an existing 1.1 config even with --adopt', ...)
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/config.test.mjs`
Expected: FAIL — `config.mjs` 모듈 없음 / 옵션 미인식.

- [ ] **Step 3: 구현**

`scripts/lib/config.mjs`에 `loadConfig`, `initCommand`, 검증 상수 `INTAKE_ADAPTERS`, `EXECUTION_ADAPTERS`를 구현한다. `core.mjs`의 `loadConfig` 사용처는 import로 바꾼다. `schema_version`은 `'1.0'`·`'1.1'`만 허용. `test_globs`는 문자열 배열, `id_pattern`은 `{id}`를 포함한 문자열 또는 null(포함하지 않으면 오류 `"verification.id_pattern must contain {id}"`).

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 43 + 6 통과, 0 실패.

- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add config schema 1.1 with intake, execution and verification sections

Adapters are chosen per project in config rather than in plugin files.
A 1.0 config keeps working with native intake and inline execution so
existing fianchetto runs need no migration; init --adopt copies an old
config into the new location without moving run directories."
```

---

### Task 4: 환경 감지 `detect`

**Files:**
- Create: `scripts/lib/detect.mjs`, `tests/detect.test.mjs`
- Modify: `scripts/spec-cycle.mjs` (case `detect`)
- Test: `tests/detect.test.mjs`

**Interfaces:**
- Produces: `detect({ projectRoot, exec = defaultExec }) → Detection`:
  ```js
  // Detection
  { task_master: { cli: boolean, tasks_file: string|null },          // which task-master, .taskmaster/tasks/tasks.json
    superpowers: boolean,                                             // `claude plugin list` 출력에 /superpowers@/ 매칭
    baseline_candidates: string[],                                    // 존재하는 것만, 스펙 §6.3 순서
    decision_records_candidate: string|null,                          // docs/decisions 존재 시
    test_glob_candidates: string[],                                   // 스펙 §6.3 목록 중 매칭 파일이 1개 이상인 패턴
    existing_config: { spec_gate: string|null, spec_cycle: string|null },
    suggested: { intake: 'native'|'taskmaster', execution: 'superpowers'|'inline' } }
  ```
  `exec(command: string, args: string[]) → { status: number, stdout: string }`. 기본 구현은 `spawnSync`. CLI `detect [--project <dir>]`는 YAML로 출력한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/detect.test.mjs`) — 모두 `exec`를 주입한 함수 호출

```js
test('detect suggests taskmaster intake when the CLI and tasks.json exist', ...)
  // exec: which task-master → {status:0, stdout:'/usr/bin/task-master'}; 프로젝트에 .taskmaster/tasks/tasks.json 생성
  // → task_master.cli true, tasks_file '.taskmaster/tasks/tasks.json', suggested.intake 'taskmaster'
test('detect suggests inline execution when superpowers is not installed', ...)
  // exec: claude plugin list → stdout 'code-review@anthropic-plugin-directory' → superpowers false, suggested.execution 'inline'
test('detect lists only baseline documents that exist, in spec order', ...)
  // docs/TECH_STACK.md, docs/PRD.md 생성 → baseline_candidates deep-equals ['docs/PRD.md','docs/TECH_STACK.md']
test('detect reports an existing .spec-gate config for adoption', ...)
test('detect treats a failing exec as absent instead of throwing', ...)
  // exec → {status: 127, stdout: ''} 둘 다 → cli false, superpowers false
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/detect.test.mjs`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`detect.mjs`에 위 시그니처를 구현한다. glob 후보 매칭은 Task 10이 만들 `globToRegExp`가 아직 없으므로, 이 task에서 `scripts/lib/glob.mjs`에 `globToRegExp(pattern: string) → RegExp`(지원: `**`, `*`, `?`; 경로 구분자는 `/`)와 `matchGlobs(root, patterns) → string[]`(저장소 상대 경로, 정렬, `node_modules`·`.git` 제외)를 만들고 테스트 3개(`**` 디렉터리 횡단, `*`는 `/`를 넘지 않음, 결과 정렬)를 `tests/glob.test.mjs`에 추가한다.

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add environment detection for init

The init command fills config defaults from what the project already
has (Task Master artefacts, superpowers, baseline documents, test
layout) so a new project needs no hand-written config. Shell probes
are injected so tests never call real CLIs."
```

---

### Task 5: `set-status` (주석 보존)

**Files:**
- Create: `scripts/lib/work-items.mjs`, `tests/work-items.test.mjs`
- Modify: `scripts/spec-cycle.mjs` (case `set-status`)
- Test: `tests/work-items.test.mjs`

**Interfaces:**
- Produces: `setStatus({ projectRoot, workItemsFile, taskId, status }) → { task_id, from, to }`. 허용 전이 상수 `ALLOWED_TRANSITIONS = { pending: ['in-progress', 'done'], 'in-progress': ['done'] }`. 같은 상태로의 전이는 no-op `{from, to}` 반환(오류 아님). 그 외 `ValidationError("W06: status transition done -> pending is not allowed")`. 항목 없음 → `ValidationError("work item W99 not found")`. 하위 항목(`W06.1`)도 같은 규칙으로 찾는다. 파일은 `YAML.parseDocument` → `doc.setIn` → `doc.toString()`으로 써서 주석과 키 순서를 보존한다.
- Produces: `definitionalFields(item) → object` — `title, description, details, test_strategy, dependencies, source_refs, acceptance_refs`만 뽑은 객체(없는 키는 `null`/`[]`). Task 8이 쓴다.
- CLI: `set-status --task <id> --status <status> [--config <file>]` → 결과를 YAML로 출력.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('set-status moves a pending item to in-progress and keeps file comments', ...)
  // work-items.yaml에 "# keep me" 주석 포함 → set-status → 파일에 주석 유지, status 변경
test('set-status allows pending to done for items implemented without implement', ...)
test('set-status rejects done to pending', ...)   // stderr 포함 "transition done -> pending is not allowed"
test('set-status rejects an unknown work item', ...)
test('set-status on the same status is a no-op', ...)
test('set-status finds a dotted subtask id', ...)
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/work-items.test.mjs`, Expected: FAIL.

- [ ] **Step 3: 구현** — 위 시그니처대로.

- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add set-status with an explicit transition table

Work-item status is the one field the cycle itself changes, so the
change goes through a single command that allows only the transitions
implement and verify need and preserves the file's comments."
```

---

### Task 6: Task Master intake `import-taskmaster`

**Files:**
- Create: `scripts/lib/intake-taskmaster.mjs`, `tests/intake-taskmaster.test.mjs`, `references/adapters.md` (intake 절)
- Modify: `scripts/spec-cycle.mjs` (case `import-taskmaster`), `skills/work-items/SKILL.md`
- Test: `tests/intake-taskmaster.test.mjs`

**Interfaces:**
- Consumes: `readWorkItems`, `writeYaml`, `ValidationError` (core), `loadConfig` (config).
- Produces: `importTaskMaster({ projectRoot, tasksFile, tag, workItemsFile }) → { tag, created: string[], updated: string[], deferred: string[], warnings: string[] }`. 매핑은 스펙 §6.2 표 그대로. `tag`가 null이면 `.taskmaster/state.json`의 `currentTag`, 없으면 `master`. `tasks.json` 형식: `{ <tag>: { tasks: [] } }` / `{ tasks: [] }` / `[]`. 재수입 매칭 키는 `external_ref`. 쓰기는 `YAML.parseDocument` 기반으로 기존 주석을 보존하고 새 항목은 `items` 끝에 덧붙인다.
- Produces: `externalRef(tag, id) → \`taskmaster:${tag}:${id}\``, `workItemId(id) → \`T${id}\``.
- CLI: `import-taskmaster [--tasks <file>] [--tag <name>] [--work-items <file>] [--config <file>]` — 옵션이 없으면 config의 `intake.taskmaster`와 `work_items`를 쓴다. 결과를 YAML로 출력.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('import creates T-prefixed items from a tagged tasks.json with dotted subtask ids', ...)
  // {master:{tasks:[{id:6,title:'Undo',subtasks:[{id:1,title:'Store'}],dependencies:[4,'5.2'],priority:'high',status:'pending',testStrategy:'unit'}]}}
  // work-items 계약은 subtasks 를 중첩으로 두고 하위 id 는 부모 기준 접미다(normalizer 가 T6.1 로 만든다). 따라서:
  //   items[0].id === 'T6', items[0].subtasks[0].id === '1', items[0].subtasks[0].external_ref === 'taskmaster:master:6.1',
  //   items[0].dependencies deep-equals ['T4','T5.2'], items[0].external_ref === 'taskmaster:master:6', test_strategy 'unit'
test('import accepts legacy {tasks:[]} and bare array formats', ...)
test('import maps review to in-progress and cancelled to deferred on first import', ...)
test('import appends acceptanceCriteria text to details and leaves acceptance_refs empty', ...)
  // details 끝에 "\n\nAcceptance criteria (Task Master):\n- ..." 포함, acceptance_refs deep-equals []
test('re-import keeps locally enriched source_refs, acceptance_refs and status', ...)
  // 1차 수입 후 source_refs 추가·status done 으로 편집 → TM 쪽 title 변경 후 재수입
  // → title 갱신, source_refs 유지, status 'done' 유지, warnings 에 상태 불일치 1건
test('re-import marks items missing from tasks.json as deferred with a reason', ...)
test('import preserves comments in work-items.yaml', ...)
test('import fails with the available tags when the requested tag is absent', ...)
  // stderr 포함 "tag phase2 not found; available: master"
test('import coerces numeric ids and string dependencies consistently', ...)   // Review Focus 2
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/intake-taskmaster.test.mjs`, Expected: FAIL.

- [ ] **Step 3: 구현** — `intake-taskmaster.mjs`. 상태 매핑 상수 `STATUS_MAP = { pending:'pending', 'in-progress':'in-progress', done:'done', review:'in-progress', deferred:'deferred', cancelled:'deferred' }`; 미지의 값은 `pending` + warning.

- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: 모두 통과.

- [ ] **Step 5: 스킬·문서 갱신**

`skills/work-items/SKILL.md`에 "Intake adapter" 절을 추가한다: config의 `intake.adapter`가 `taskmaster`면 먼저 `node ${CLAUDE_PLUGIN_ROOT}/scripts/spec-cycle.mjs import-taskmaster`를 실행하고, 그 결과의 `created`/`updated` 항목에 대해 기존 "Shape each item" 규칙으로 `source_refs`·`acceptance_refs`를 보강하며, `external_ref`와 id는 바꾸지 않는다. `references/adapters.md`를 만들고 intake 절에 스펙 §6의 매핑 표와 재수입 규칙을 영어로 적는다(execution 절은 Task 11).

- [ ] **Step 6: Commit**

```bash
git add scripts tests skills references
git commit -m "Add Task Master intake adapter

Team projects already decompose work with task-master; import its
tasks.json into the work-item contract as a draft so the gate's
traceability rules (source_refs notices, acceptance coverage) still
apply. Import is one-way: local enrichment and status are kept on
re-import and the Task Master id survives as external_ref."
```

---

### Task 7a: 결정표 평가기

**Files:**
- Create: `scripts/lib/decision.mjs`, `tests/decision.test.mjs`
- Modify: `scripts/spec-cycle.mjs` (case `check-decision`, `decision-vectors`)
- Test: `tests/decision.test.mjs`

**Interfaces:**
- Produces: `evaluateTable(decision: object) → Evaluation`:
  ```js
  // Evaluation
  { errors: string[],                 // 비어 있지 않으면 나머지는 신뢰하지 않음
    cells_total: number,
    rules: [{ rule_id, wins: [{ inputs: Record<string,string>, expected: Record<string,string> }],
              shadowed: [{ inputs, winner: string }] }],   // DEFAULT 규칙은 rule_id 'DEFAULT' 로 포함
    gaps: [{ inputs }],
    overlaps: [{ inputs, rules: string[], winner: string|null }] }
  ```
  규칙: 스펙 §9.1–§9.2. 상수 `MAX_CELLS = 10000`, `MISSING = '<missing>'`, `SUPPORTED_HIT_POLICIES = ['UNIQUE','FIRST','ANY']`. 모든 값 비교는 `String(value)`. 오류 메시지 형식: `"rule R2 input volume_state value foo is not in allowed_values"`, `"gap: {volume_state: mounted, error_kind: other}"`, `"UNIQUE overlap: {…} matches R1, R2"`, `"FIRST overlaps exist but overlap_analysis is empty"`, `"ANY overlap with different outputs: {…} R1, R3"`, `"hit_policy PRIORITY is not supported by table-v1; use review-only"`, `"ordered_rules must be true for FIRST"`, `"cells_total 12000 exceeds 10000; split the table"`, `"default_rule is unreachable"`.
- Produces: `obligationIdFor(taskId, decisionId, ruleId) → string` (`${taskId}-${decisionId}-${ruleId}`), `vectorsArtifact({ decision, tablePath, tableFingerprint, taskId }) → object` (스펙 §5.3 모양; `rules[].obligation_id` 채움).
- CLI: `check-decision --table <file>` → Evaluation을 YAML로 stdout; errors가 있으면 각 줄 `- ` 접두어로 stderr, 종료 1. `decision-vectors --table <file> --out <file>` → check 통과 시 §5.3 파일 작성(기존 파일이 있고 내용이 다르면 거부 메시지 `"Refusing to overwrite vectors that differ: <out>"`).

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/decision.test.mjs`) — 함수 직접 호출 + CLI 1~2개

```js
test('UNIQUE table with full coverage has no gaps or overlaps and one win per cell', ...)
  // inputs a:[x,y], b:[p,q], rules 4개 → cells_total 4, gaps [], overlaps [], 각 rule wins 길이 1
test('UNIQUE table reports a gap cell when no rule and no default matches', ...)
test('UNIQUE table reports an overlap as an error', ...)
test('FIRST table resolves overlaps to the earlier rule and records shadowed cells', ...)
  // fianchetto W06 표(bookmark_failure_cause)를 그대로 사용 → R1 wins 3, overlaps 2건(winner R1), R2.shadowed 1, R5.shadowed 1
test('FIRST table with overlaps requires a non-empty overlap_analysis', ...)
test('ANY table accepts overlapping rules with identical outputs and rejects differing ones', ...)
test('blank_means missing adds <missing> to the domain and an omitted cell matches only it', ...)
test('a literal outside allowed_values is an error for both when and then', ...)
test('boolean inputs compare as strings', ...)                     // Review Focus 3: allowed_values [true,false], when {flag: true}
test('a list cell matches any listed value', ...)                   // when {tier: [GOLD, SILVER]}
test('default_rule collects uncovered cells under DEFAULT and is an error when unreachable', ...)
test('PRIORITY and COLLECT are rejected', ...)
test('tables above 10000 cells are rejected', ...)                  // 입력 5개 × 7값 = 16807
test('vectors artifact is byte-identical across two renders with Korean values', ...)   // Review Focus 5
test('decision-vectors CLI refuses to overwrite a differing vectors file', ...)
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/decision.test.mjs`, Expected: FAIL.

- [ ] **Step 3: 구현** — `decision.mjs`. 셀 열거는 도메인의 데카르트 곱을 재귀 없이 인덱스 증가로 만든다(10,000 상한이라 메모리 무관). 벡터 파일 쓰기는 `YAML.stringify(value, { lineWidth: 0 })`로 결정론을 보장한다.

- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: 모두 통과.

- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add table-v1 decision table evaluator

Gap and overlap analysis used to be prose the author asserted and the
critic read. Enumerating the finite input domain makes both a computed
fact, and per-rule win cells become the test vectors TDD works from."
```

---

### Task 7b: table-v1를 작성자 검증·handoff·fixture에 통합

**Files:**
- Modify: `scripts/lib/core.mjs` (`validateDecision`, `validateAuthorFile`, `buildHandoff`), `fixtures/cases/dmn/**`, `fixtures/cases/both/**`, `references/contracts.md`, `references/routing-and-formats.md`, `references/critic-policy.md`, `skills/specification-author/SKILL.md`, `skills/specification-critic/SKILL.md`, `agents/specification-critic-agent.md`
- Test: `tests/core.test.mjs` (추가), `tests/decision.test.mjs` (추가)

**Interfaces:**
- Consumes: `evaluateTable`, `vectorsArtifact`, `obligationIdFor` (7a).
- Produces: `validateDecision(file, taskId, { projectRoot, specFiles })` — `execution_format`가 `review-only`면 기존 검사 그대로; `table-v1`이면 `evaluateTable` 오류를 포함하고, 같은 디렉터리의 `<basename>.vectors.yaml`이 `specFiles`에 있고 `table_fingerprint`가 현재 표의 sha256과 같아야 한다(`"vectors file is stale: regenerate with decision-vectors"`). `validateAuthorFile`은 table-v1 표의 모든 `rules[].rule_id`(DEFAULT 포함)에 대해 `kind: decision-rule`이고 `source`가 `<table>#<rule_id>`인 obligation을 요구한다(`"W06: rule R4 of bookmark_failure_cause has no decision-rule obligation"`). `buildHandoff`는 `schema_version: '1.1'`과 `decision_vectors`(각 table-v1 표의 벡터 파일 `rules`)를 쓴다. review-only만 있으면 `decision_vectors: []`.

- [ ] **Step 1: 실패하는 테스트 작성** (`tests/core.test.mjs`에 추가)

```js
test('author validation runs the evaluator on a table-v1 decision table', ...)
  // dmn fixture 복사 → 표의 R4 삭제(gap) → validate-author 실패, stderr 포함 "gap:"
test('author validation rejects a stale vectors file', ...)
  // 표의 then 값 하나 변경 후 벡터 미재생성 → "vectors file is stale"
test('author validation requires one decision-rule obligation per table-v1 rule', ...)
test('a review-only table still validates with a single table-level obligation', ...)
  // dmn fixture의 표를 review-only로 되돌리고 vectors 제거, obligation 1개 → 통과
test('READY handoff carries decision vectors for table-v1 tables', ...)
  // dmn fixture → build-handoff → handoff.schema_version '1.1', decision_vectors[0].rules 길이 === 표 규칙 수
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/core.test.mjs`, Expected: 새 테스트 5개 FAIL(fixture는 아직 review-only).

- [ ] **Step 3: 구현** — `core.mjs` 변경. `validateDecision`의 세 번째 인자는 선택이며 없으면 review-only 검사만 한다(기존 호출 호환).

- [ ] **Step 4: fixture 갱신**

`fixtures/cases/dmn/run/specs/task-3.decision.yaml`과 `fixtures/cases/both/run/specs/task-4.decision.yaml`을 `execution_format: table-v1`로 바꾸고(`order_subtotal`의 `allowed_values`는 `["< 100000", ">= 100000"]` 구간 라벨, 셀도 같은 라벨), `node scripts/spec-cycle.mjs decision-vectors --table <표> --out <표 basename>.vectors.yaml`로 벡터를 만든다. manifest `spec_files`에 벡터 파일을 추가하고 obligation을 규칙별로 바꾼다(`T3-membership-discount-R1` … , `kind: decision-rule`, `source: run/specs/task-3.decision.yaml#R1`). `expected.yaml`은 그대로. 비평 보고의 `reviewed_fingerprint`는 `node scripts/spec-cycle.mjs fingerprint --manifest <manifest>`로 다시 계산해 넣는다. `fixtures/dry-run`은 GHERKIN만이라 변경 없음.

- [ ] **Step 5: 통과 확인**

Run: `npm test && npm run validate:fixtures`
Expected: 모두 통과, `6/6 fixtures PASS`.

- [ ] **Step 6: 문서·스킬 갱신**

- `references/contracts.md`: §5.2–§5.5의 내용을 영어로 추가(table-v1 표, 벡터 파일, 규칙별 obligation, handoff 1.1).
- `references/routing-and-formats.md`: "Decision table" 절을 table-v1 기본·review-only 예외로 바꾸고 셀 문법·구간 라벨 규칙·`decision-vectors` 실행을 적는다.
- `references/critic-policy.md`: "Decision tables: run `check-decision` and cite its output; do not accept `gap_analysis` prose as evidence of completeness."
- `skills/specification-author/SKILL.md` "Author a new run" 6번: table-v1로 쓰고 `decision-vectors`를 실행해 `spec_files`에 넣고 규칙별 obligation을 만든다. review-only는 이유를 `assumptions`에 적는다.
- `skills/specification-critic/SKILL.md`, `agents/specification-critic-agent.md` "Establish review inputs"에 `check-decision` 실행 단계를 추가.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Enforce table-v1 decision tables in author validation and handoff

The validator now computes gaps and overlaps, rejects stale vectors,
and requires one obligation per rule so coverage can be verified per
rule later. review-only tables remain valid for the existing runs."
```

---

### Task 8: `resolve-handoff`

**Files:**
- Create: `scripts/lib/handoff.mjs`, `tests/handoff.test.mjs`
- Modify: `scripts/spec-cycle.mjs` (case `resolve-handoff`), `scripts/lib/work-items.mjs` (`definitionalFields` 사용)
- Test: `tests/handoff.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `sourceSnapshot`, `readWorkItems`, `flattenWorkItems`, `readYaml`, `definitionalFields`.
- Produces: `resolveHandoff({ projectRoot, configArg, taskId }) → Resolution`:
  ```js
  { task_id, run_id: string|null, run_dir: string|null, handoff: string|null, brief: string|null,  // brief = `${run_dir}/spec-brief.md` (존재 여부 무관)
    handoff_schema: '1.0'|'1.1'|null, usable: boolean, errors: string[], warnings: string[], work_item_status: string|null }
  ```
  선택: `run_root` 아래 디렉터리 중 `tdd-handoff.yaml`이 있고 `source_tasks[].task_id`에 `taskId`가 포함된 것들 중 handoff 파일 mtime이 가장 최근. 판정은 스펙 §8.1 표. 정의 필드 비교는 run의 `normalized-tasks.yaml`의 task와 현재 `flattenWorkItems` 결과의 같은 `task_id`를 `definitionalFields`로 비교(`dependencies`, `source_refs`, `acceptance_refs`는 정렬 후 비교). 오류 메시지: `"no READY handoff for W06; run /spec-cycle:run W06 first"`, `"baseline docs/PRD.md changed since the handoff; rerun the gate"`, `"work item W06 definition changed (fields: details, acceptance_refs); rerun the gate"`. warning: `"decision records changed since the handoff: docs/decisions/0034-x.md"`, `"work item W06 is already done"`.
- CLI: `resolve-handoff --task <id> [--config <file>] [--project <dir>]` → YAML. `usable: false`면 종료 1.

- [ ] **Step 1: 실패하는 테스트 작성** — 헬퍼 `handoffProject()`를 테스트 파일 안에 만든다: `workItemProject` + `.spec-cycle/runs/t-w01-aaaa/{normalized-tasks.yaml, tdd-handoff.yaml}` 를 현재 fingerprint로 작성.

```js
test('resolve-handoff reports no handoff for a work item that never passed the gate', ...)
test('resolve-handoff selects the most recent run that has a handoff for the task', ...)   // 두 run, mtime 차이는 fs.utimesSync 로 고정
test('resolve-handoff is unusable when a baseline document changed', ...)
test('resolve-handoff is unusable when a definitional field of the work item changed', ...)   // details 수정
test('resolve-handoff ignores a status change of the work item', ...)                          // status pending→in-progress 만 → usable true
test('resolve-handoff warns but stays usable when only decision records changed', ...)
test('resolve-handoff reads a 1.0 handoff without decision_vectors', ...)                      // Review Focus 4
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/handoff.test.mjs`, Expected: FAIL.
- [ ] **Step 3: 구현** — `handoff.mjs`.
- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: 모두 통과.
- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add resolve-handoff to find the usable READY handoff for a work item

implement and verify must refuse a handoff whose baseline or work-item
definition changed, but a decision-record change is expected because
promotion happens right after READY, so it is a warning not an error."
```

---

### Task 9: `render-brief`와 `check-plan`

**Files:**
- Create: `scripts/lib/brief.mjs`, `tests/brief.test.mjs`
- Modify: `scripts/spec-cycle.mjs` (case `render-brief`, `check-plan`)
- Test: `tests/brief.test.mjs`

**Interfaces:**
- Consumes: `readYaml`, `resolveArtifact`, `findProjectRoot`, `walkFiles`, `evaluateTable` (셀 맵 렌더용).
- Produces: `renderBrief({ handoffFile }) → string` — 스펙 §5.6의 7개 절을 Markdown으로. 결정론: 입력 파일 외의 시간·환경 값을 쓰지 않는다. 절 제목(한국어, 고정): `# 명세 브리프 — <task_id> <title>`, `## 1. 작업 항목`, `## 2. 승인된 명세`, `## 3. Test obligations`, `## 4. 결정 벡터`, `## 5. 결정`, `## 6. Non-blocking notes`, `## 7. 검증 계약`. §7 본문은 정확히: `모든 테스트의 이름 또는 태그에 그 테스트가 증명하는 obligation_id를 포함한다. /spec-cycle:verify 가 이 문자열을 찾는다.` 결정 기록 절은 handoff의 `decision_log` 항목과, config `decision_records` 디렉터리에서 본문에 `run_id`가 포함된 `.md` 파일 경로를 정렬해 나열한다.
- Produces: `writeBrief({ handoffFile, outFile }) → { path, status: 'created'|'unchanged' }` — 기존 파일이 있고 내용이 다르면 `Error("brief already exists with different content: <out>")`.
- Produces: `checkPlan({ planFile, handoffFile }) → { total: number, missing: string[] }` — handoff의 모든 `test_obligations[].obligation_id`가 plan 본문에 리터럴로(Review Focus 1 규칙과 같은 경계) 나타나는지.
- CLI: `render-brief --handoff <file> --out <file>`; `check-plan --plan <file> --handoff <file>` → YAML, `missing`이 있으면 종료 1.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('render-brief includes every obligation id and every accepted specification path', ...)   // dmn fixture handoff(7b에서 build) 사용
test('render-brief is byte-identical on two renders with Korean scenario names', ...)          // gherkin fixture
test('render-brief renders a 1.0 handoff without a decision vectors section body', ...)         // Review Focus 4: §4 에 "없음"
test('render-brief renders table-v1 cells as a markdown table with the winning rule per cell', ...)
test('write-brief refuses to overwrite a brief with different content', ...)
test('check-plan lists obligations absent from the plan and exits 1', ...)
test('check-plan does not accept a prefix match', ...)                                          // Review Focus 1
test('check-plan passes when every obligation appears', ...)
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/brief.test.mjs`, Expected: FAIL.
- [ ] **Step 3: 구현** — `brief.mjs`. id 경계 검사 함수 `containsId(text, id) → boolean`은 `scripts/lib/ids.mjs`에 두고 Task 10도 쓴다(정규식: 이스케이프한 id 뒤에 `(?![A-Za-z0-9_-])`, 앞에 `(?<![A-Za-z0-9_-])`).
- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: 모두 통과.
- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add render-brief and check-plan for the implementation handoff

superpowers writing-plans takes a spec document, so the READY handoff
is rendered once into a deterministic markdown brief, and check-plan
confirms the resulting plan assigns every obligation before any code
is written."
```

---

### Task 10: `verify-obligations`와 `status`

**Files:**
- Create: `scripts/lib/verify.mjs`, `tests/verify.test.mjs`
- Modify: `scripts/spec-cycle.mjs` (case `verify-obligations`, `status`)
- Test: `tests/verify.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `matchGlobs` (glob.mjs), `containsId` (ids.mjs), `resolveHandoff`, `setStatus`, `readWorkItems`, `flattenWorkItems`.
- Produces: `verifyObligations({ projectRoot, configArg, taskId, outFile }) → Verification` (스펙 §5.8). `id_pattern`이 null이면 `containsId`; 문자열이면 `{id}`를 이스케이프한 id로 치환한 `RegExp`. `test_globs`가 비었거나 매칭 파일 0개 → `ValidationError("verification.test_globs matched no files; set it in .spec-cycle/config.yaml")`. `locations`는 `경로:줄` 문자열 배열(정렬). 결과 파일은 덮어쓴다(검증은 반복된다). `status_written`은 이 함수가 쓰지 않고 null로 둔다 — 상태 전이는 커맨드가 `set-status`로 따로 하고 결과 파일을 갱신한다(`--mark-done` 옵션: 미커버 0개일 때만 `set-status … done`을 호출하고 `status_written: done` 기록, 아니면 오류 `"1 obligation(s) uncovered; status unchanged"`).
- Produces: `statusTable({ projectRoot, configArg }) → Row[]`, `Row = { id, title, status, latest_run, verdict, handoff: boolean, coverage: string|null }` — `coverage`는 run_dir의 `verification.yaml`이 있으면 `"covered/total"`, 없으면 null. `verdict`는 run_dir의 가장 큰 번호 `critic-pass-N.yaml`의 `verdict`.
- CLI: `verify-obligations --task <id> [--out <file>] [--mark-done] [--config <file>]` → Verification YAML, 미커버가 있으면 종료 1. `status [--config <file>]` → Row 배열 YAML.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('verify-obligations reports covered and uncovered obligations with locations', ...)
  // handoffProject(Task 8 헬퍼를 helpers.mjs 로 승격) + tests/A.test.mjs 에 "W01-rename-records-revision" 포함 → covered true, locations ['tests/A.test.mjs:3']
test('verify-obligations does not count a prefix match as coverage', ...)              // Review Focus 1: 파일에 W01-x-10 만 있고 obligation W01-x
test('verify-obligations ignores matches outside test_globs', ...)
test('verify-obligations fails when test_globs match no files', ...)
test('verify-obligations applies id_pattern with {id} substitution', ...)              // id_pattern "@Test\\(\"\\[{id}\\]" 꼴
test('verify-obligations --mark-done writes done only when nothing is uncovered', ...)
test('verify-obligations reads a 1.0 handoff', ...)                                      // Review Focus 4
test('status lists each work item with its latest run verdict and coverage', ...)
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/verify.test.mjs`, Expected: FAIL.
- [ ] **Step 3: 구현** — `verify.mjs`. `handoffProject` 헬퍼를 `tests/helpers.mjs`로 옮기고 Task 8 테스트도 그것을 쓰게 바꾼다.
- [ ] **Step 4: 통과 확인** — Run: `npm test`, Expected: 모두 통과.
- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "Add verify-obligations and status to close the cycle

The gate used to end at the handoff; nothing checked that tests
actually carried the obligation ids. verify scans the configured test
files for each id and is the only path that marks a work item done."
```

---

### Task 11: 커맨드 4개, execution 어댑터 문서, README

**Files:**
- Create: `commands/init.md`, `commands/implement.md`, `commands/verify.md`
- Modify: `commands/run.md`, `references/adapters.md` (execution 절), `docs/integration.md`, `README.md`, `scripts/spec-cycle.mjs` (`usage()` 전체 서브커맨드)
- Test: 플러그인 로드·검증 명령

**Interfaces:**
- Consumes: 모든 CLI 서브커맨드.
- Produces: 사람이 호출하는 진입점 `/spec-cycle:init`, `/spec-cycle:run`, `/spec-cycle:implement`, `/spec-cycle:verify` (+ 스킬 `/spec-cycle:work-items`).

- [ ] **Step 1: `commands/init.md`**

frontmatter `description: "프로젝트 초기화 — 환경 감지 → .spec-cycle/config.yaml 생성 (기존 .spec-gate 설정 채택 지원)"`, `argument-hint: "[--adopt path] [--baseline a,b]"`. 본문: `${CLAUDE_PLUGIN_ROOT}` 미확장 처리(run.md와 동일 문단) → `detect` 실행 → 후보가 여럿이거나 `suggested`와 다른 선택이 필요하면 `AskUserQuestion`(권장 선택지 첫 번째, "(권장)") → `init` 실행(1.1) → 생성 파일과 선택된 어댑터를 표로 보고 → 다음 행동 한 줄(`/spec-cycle:work-items`). 기존 config는 덮어쓰지 않는다고 명시.

- [ ] **Step 2: `commands/run.md` 수정**

스펙 §7의 네 변경만 반영: 네임스페이스, 작성 단계의 table-v1·`decision-vectors`, 비평 단계의 `check-decision`, 마지막 안내에서 `execution.adapter`별 다음 커맨드(`superpowers`/`inline` → `/spec-cycle:implement <id>`, `command` → 설정된 커맨드와 외부 id, brief를 먼저 읽을 것). 5절 "TDD 인계"의 세션 내 TDD 서술은 `inline` 어댑터 설명으로 `implement.md`로 옮기고 run.md에서는 제거한다.

- [ ] **Step 3: `commands/implement.md`**

frontmatter `description: "READY handoff → 명세 브리프 → 실행 어댑터(superpowers / inline / command) 인계"`, `argument-hint: "<work-item-id>"`. 본문은 스펙 §8 그대로: `resolve-handoff`(usable false면 오류 메시지를 그대로 전달하고 멈춤; warning은 보고) → `render-brief` → `set-status … in-progress` → 어댑터 분기. superpowers 절에는 §8.3의 세 규약 문장을 인용부호로 그대로 넣고, `Skill` 도구로 `superpowers:writing-plans`를 brief 경로와 함께 호출한다고 적는다. plan 저장 후 `check-plan`을 돌리고 `missing`이 비어야 다음으로. "실행 방식 선택은 superpowers의 질문에 사람이 답한다. 이 커맨드는 묻지 않는다." superpowers 미설치(`detect`의 `superpowers: false`)면 inline으로 내려가고 그 사실을 첫 줄에 보고. command 절: `external_ref`가 있으면 외부 id, 없으면 work item id로 설정된 커맨드를 사람이 호출하도록 한 줄 안내. "이 커맨드가 하지 않는 것": 코드·테스트 작성(inline에서 사람이 지시한 뒤에만), 상태 `done` 기록, 다른 커맨드 대리 실행.

- [ ] **Step 4: `commands/verify.md`**

frontmatter `description: "obligation 커버리지 검증 — 테스트 파일에서 obligation_id 확인, 통과 시에만 작업 항목 done"`, `argument-hint: "<work-item-id>"`. 본문은 스펙 §10: `verify-obligations --task <id> --out <run_dir>/verification.yaml` → 미커버 표 → `test_command` 있으면 실행 결과 기록, 없으면 `AskUserQuestion`으로 테스트 실행 확인(답을 보고에 `human_confirmed_tests`로 남김) → 조건 충족 시 `verify-obligations --mark-done` 재실행 → 최종 보고(커버 n/m, 상태, 다음 행동: 남은 항목은 `status`로).

- [ ] **Step 5: `references/adapters.md` execution 절, `docs/integration.md`, `usage()`**

adapters.md에 execution 어댑터 세 종류의 계약(입력: brief·handoff, 출력: 사람에게 안내하는 다음 행동, 금지: 상태 done 기록)을 영어로 적는다. `docs/integration.md`의 run layout에 `<task>.decision.vectors.yaml`, `spec-brief.md`, `verification.yaml`을 추가하고 "Invocation boundary"를 `init → work-items → run → implement → verify`로 갱신한다. `usage()`에 모든 서브커맨드를 나열한다.

- [ ] **Step 6: `README.md` 재작성(한국어)**

절: 한 줄 소개와 사이클 그림(스펙 §1) / 핵심 설계 표(스펙 §1.1 표를 사용자 관점으로) / 구성 요소 표(커맨드 4 + 스킬 3 + 에이전트 1 + 스크립트) / 요구 환경(Claude Code ≥ 2.1.231, Node ≥ 20.11, superpowers 선택, Task Master 선택) / 설치(§12 명령) / 프로젝트에서 쓰기(`init` → `work-items` → `run` → `implement` → `verify`, 각 한 문단) / 설정 예 3개(개인+superpowers, Task Master+task-cycle, 1.0 채택) / 판정 표(현행) / 결정표 table-v1 요약 / 검증(`npm test`, `npm run validate`, fixtures) / 현재 제한 사항(write-back 없음, DMN XML 없음, 커버리지는 존재 검사, 실전 표본 0건). fianchetto 전용 서술은 모두 제거.

- [ ] **Step 7: 검증**

Run: `npm run validate`
Expected: `claude plugin validate . --strict` 통과; `plugin details spec-cycle`에 commands 4개(init, run, implement, verify), skills 3개(specification-author, specification-critic, work-items), agent 1개; `npm test` 전부 통과. 항상 켜져 있는 토큰 비용을 details 출력에서 읽어 README "요구 환경" 아래에 한 줄로 기록한다.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add init, implement and verify commands and rewrite the README

The four commands are the only human entry points of the cycle. init
turns detection into config, implement hands a READY handoff to the
configured execution adapter without approving anything itself, and
verify is the single place a work item becomes done."
```

---

### Task 12: Task Master fixture, 전체 fixture 검증, 검증 결과 문서

**Files:**
- Create: `fixtures/cases/taskmaster/{expected.yaml, input/PRD.md, input/tasks.json, input/work-items.yaml, run/normalized-tasks.yaml, run/author-manifest.yaml, run/critic-pass-1.yaml, run/specs/task-T6.feature}`
- Modify: `scripts/lib/core.mjs` (`validateFixtures`가 `input/tasks.json`이 있으면 `importTaskMaster`를 임시 디렉터리에서 돌려 `input/work-items.yaml`과 id·external_ref가 일치하는지 확인), `tests/core.test.mjs` (fixture 수 7), `docs/validation-results.md`, `reports/` (gitignore 유지)
- Test: `tests/core.test.mjs`

**Interfaces:**
- Consumes: `importTaskMaster`.
- Produces: fixture `taskmaster` — route GHERKIN, verdict READY, 작업 항목 `T6`(external_ref `taskmaster:master:6`), `input/work-items.yaml`은 수입 초안에 `source_refs: [input/PRD.md#undo]`, `acceptance_refs: [A01]`을 보강한 상태.

- [ ] **Step 1: 실패하는 테스트 수정**

`tests/core.test.mjs`의 `'all six semantic fixtures …'`를 `'all seven semantic fixtures …'`로 바꾸고 기대 fixture 목록에 `taskmaster`를 추가. 새 테스트: `test('taskmaster fixture work items are reproducible from tasks.json by import', ...)` — 임시 디렉터리에 `input/tasks.json` 복사 → `import-taskmaster` → 생성 항목의 `id`·`external_ref`·`title`이 fixture `input/work-items.yaml`과 같다(보강 필드는 비교하지 않음).

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/core.test.mjs`, Expected: fixture 없음으로 FAIL.

- [ ] **Step 3: fixture 작성**

`gherkin` fixture를 본으로 복사하고 작업 항목 id를 `T6`으로, `input/tasks.json`은 `{ "master": { "tasks": [{ "id": 6, "title": "Undo the last confirmed change", "description": "...", "details": "...", "testStrategy": "...", "priority": "high", "status": "pending", "dependencies": [], "subtasks": [] }] } }`. manifest·critic 보고의 fingerprint는 CLI로 다시 계산한다.

- [ ] **Step 4: 통과 확인**

Run: `npm test && npm run validate:fixtures && npm run metrics`
Expected: 전부 통과, `7/7 fixtures PASS`, `reports/fixture-metrics.yaml` 생성(gitignore 대상).

- [ ] **Step 5: `docs/validation-results.md` 작성**

실행한 명령과 실제 출력 요약(테스트 수, fixture 수, plugin details 결과, 날짜, Claude Code·Node 버전)을 표로 기록한다. "검증하지 않은 것" 절에 다음을 명시: 실제 `run → implement(superpowers) → verify` 실전 run 0건(첫 실전 검증은 fianchetto W20, 스펙 §14), Task Master 실프로젝트 수입 0건.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add Task Master fixture and record validation results

The intake adapter needs a fixture that proves tasks.json import feeds
the gate end to end. validation-results separates what the fixtures
show from what only a real run can."
```

---

## 계획 이후 (구현 task가 아님)

- **첫 실전 검증(스펙 §14)**: fianchetto에서 `/spec-cycle:init --adopt .spec-gate/config.yaml` → `/spec-cycle:run W20` → `/spec-cycle:implement W20` → `/spec-cycle:verify W20`. NEEDS_HUMAN 답변이 필요하므로 사용자와 함께 진행하고 결과를 `docs/validation-results.md`에 추가한다. 이 과정에서 fianchetto 저장소에 생기는 변경(config, 결정 기록, 테스트)은 fianchetto의 커밋이다.
- **배포**: `plugin.json` 0.2.0으로 `claude plugin marketplace add /Users/unae/Documents/u.naee/spec-cycle && claude plugin install spec-cycle@spec-cycle`. 푸시는 사용자 요청 시.
