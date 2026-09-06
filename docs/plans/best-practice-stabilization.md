# mctl-academy — Best Practice Stabilization Plan

**Baseline:** `4485db7ee94e03d46a03457f81693960b74fdc5a` (main, 2026-08-09T12:10:25+02:00)
**Last CI:** [success](https://github.com/mctlhq/mctl-academy/actions/runs/from-pr-133) (PR #133 merge)
**Branch protection:** unavailable — private repo on current GitHub plan (403 on `…/branches/main/protection`)

## Severity policy

- **P0**: доказанная удалённая эксплуатация, потеря данных или production outage.
- **P1**: существенный security/reliability/accessibility риск с достижимым сценарием.
- **P2**: hardening, maintainability или developer-experience проблема.
- **P3**: необязательное улучшение или продуктовая функция.

Каждый P1 имеет воспроизводимый failure scenario и regression test.

---

## Step 0 — Enforce merge safeguards (P1 process)

**Проблема:** последние PR неоднократно мержились до завершения evidence/reviewer checks. Branch protection API возвращает 403 — техническая блокировка merge недоступна на текущем GitHub-тарифе.

**Что делаем:**
1. Запросить у владельца org upgrade до GitHub Pro ИЛИ сделать репо public (код уже Apache-2.0).
2. Пока protection недоступен — задокументировать accepted process risk:
   - Владелец ручного контроля: `@mashkovd` (CODEOWNERS на `/content/` и workflows)
   - Правило: **никто не нажимает «Merge» пока все required checks не зелёные** (lint, evidence, server tests, client tests, e2e, reviewer gate)
   - Добавить это правило в `CLAUDE.md` и `CONTRIBUTING.md`
3. Добавить check перед merge в `claude-review.yml`: если review запрошен, его結論 должен быть «approve» перед разрешением merge (reviewer gate через status check)

**Acceptance:**
- Создать тестовый PR с падающим required check
- Если protection API стал доступен — убедиться что GitHub физически запрещает merge
- Если нет — подтвердить что documented rule + CODEOWNERS review блокируют merge административно
- Записать accepted risk в план

---

## PR 1 — Restricted rendering + accessibility live region (P1)

### 1a. Replace `v-html` with existing `RestrictedMarkdown.vue`

Текущий `renderInlineMarkdown()` сначала экранирует HTML, затем конвертирует backtick-спаны в `<code>`. Это хрупко: любой будущий Markdown-фича (links, images) добавленный после escape — открывает XSS.

**Fix:** Использовать уже существующий `RestrictedMarkdown.vue` (segment-based: plain text nodes + `<code>` сегменты, без `v-html`). Не добавлять новый Markdown parser, не расширять синтаксис.

**Regression test:**
- backtick-спаны рендерятся как `<code>` (stem, option text, explanation)
- `<script>alert(1)</script>` в контенте рендерится как текст
- одинаковое поведение Practice и Mock режимов
- component test для каждого из трёх контекстов (stem, option, explanation)

### 1b. Single stable live region for feedback

Сейчас при выборе опции feedback появляется визуально, но screen reader его не анонсирует.

**Fix:** Один стабильный `aria-live="polite"` регион с `aria-atomic="true"`, который обновляется последним результатом. **Не** `role="status"` на каждом раскрытом explanation — иначе screen reader будет повторно озвучивать накопленные ответы при навигации.

**Regression test:** проверить что повторный выбор опции не вызывает дублирующих announcements; что регион очищается при переходе к следующему вопросу.

Severity: P1 defense-in-depth + P1 accessibility.

---

## PR 2a — CSRF hardening + reports policy (P1)

### requireSameOrigin on POST /api/reports

**Фактическая ошибка в предыдущей версии:** `POST /api/reports` использует только `rateLimit()`. `requireSameOrigin` на нём **отсутствует** — в отличие от `attempts.mjs`.

**Fix:** Добавить `requireSameOrigin` middleware на `POST /api/reports` независимо от решения по authentication. Добавить тест cross-origin rejection.

### Reports authentication policy

Practice mode доступен без входа — разумный default: **разрешить anonymous reports, но не сохранять идентификатор пользователя**. Оставить строгий rate limit, same-origin, question ID validation, comment length limit.

Документировать это решение в `server/app.mjs` и `PLAN.md`. Добавить abuse-path тест.

---

## PR 2b — Bounded and trusted rate limiter (P1)

**Проблемы:**
1. `hits` Map растёт неограниченно (P2 memory leak)
2. `X-Forwarded-For` доверяется безусловно (P1 trust boundary)
3. Нет overflow-семантики — при заполнении нельзя просто удалить активную запись (злоумышленник сбросит лимит)

**Fix:**

1. **Bounded storage:** сначала удалять все expired entries; если capacity всё равно исчерпана — fail-closed 429 (не вытеснять произвольную активную запись)
2. **Trusted ingress header:** явно определить какой ingress-заголовок является доверенным; не позволять прямому клиенту передавать `X-Forwarded-For`
3. **No-IP fallback:** если IP отсутствует — отдельный bucket, не «unknown» общий для всех
4. **Injectable clock + storage** для детерминированных тестов

**Тесты:**
- spoofed `X-Forwarded-For` отвергается
- несколько адресов за доверенным proxy
- capacity exhaustion → 429
- cleanup expired entries
- отсутствие IP → собственный bucket

---

## PR 3 — Generated artifact contracts (P2)

Не добавлять browser-side Zod. Валидировать на build boundary.

**Что проверять (output contract, не повтор source schema tests):**

- `validateGeneratedArtifacts(bundle, catalog)` — чистая функция
- validator отвергает malformed готовый bundle
- `publishedQuestionCount` равен числу вопросов курса в bundle
- `available === (publishedQuestionCount > 0)`
- course IDs уникальны
- domain IDs уникальны внутри курса
- сумма `mockQuestions` по доменам равна `questionCount`
- каждый bundle question ссылается на существующий course/domain
- после нормальной сборки оба generated JSON проходят contract validation

**Типы:** устранить `as unknown as Question[]` через общий совместимый тип или явный mapper `BundleQuestion → ExamQuestion`.

**Acceptance:**
- malformed generated artifact ломает build с понятной ошибкой
- production client не получает новый runtime validation dependency
- типы Practice и Mock не расходятся

---

## PR 4 — Operational documentation + headers (P2/P3)

- **`.env.example`**: каждая переменная с required/optional, server/build/CI scope, пример значения, secret/non-secret, production-only ограничения. Источник — `grep -r process.env` по коду + CI/deployment configs.
- **Stale security comment**: заменить перечень файлов на устойчивое объяснение причины:

  > `style-src 'unsafe-inline'` remains because the Vue client uses runtime style bindings that produce inline style attributes.

- **`X-Frame-Options: DENY`**: compatibility header + тест вместе с CSP `frame-ancestors 'none'`

---

## Tooling — отдельная инициатива после stabilization

Не смешивать с runtime changes. Порядок:
1. ESLint configuration (без autofix)
2. Исправить существующие нарушения отдельным коммитом
3. ESLint в CI
4. Prettier — отдельное решение
5. `checkJs` — по директориям, не сразу весь сервер

Dependabot — отдельно. Без blocking `npm audit` до определения severity policy.

---

## Explicit backlog — НЕ в stabilization pass

- Сохранение Practice session после reload (продуктовая фича, не баг)
- Разделение компонентов по числу строк (без измеримой пользы)
- Единый реестр localStorage keys
- Pre-commit hooks
- `npm run` → `bun run` (работает и так)
- Structured client logging без backend
- `content/` в Docker image (пока нет доказательств что мёртвый код)
- `console.error` gating (единственный диагностический сигнал)

---

## Рекомендуемый порядок

1. **Step 0** — merge safeguards (блокирует всё остальное)
2. **PR 1** — restricted rendering + aria-live (самый высокий user-facing impact)
3. **PR 2a** — requireSameOrigin + reports policy (маленький, независимый)
4. **PR 2b** — bounded/trusted rate limiter (требует 2a для контекста)
5. **PR 3** — generated artifact contracts (build-time, не пересекается с 1-2)
6. **PR 4** — operational documentation/headers (можно параллельно с 3)
7. **Tooling** — после полного stabilization pass

PR 3 и PR 4 можно делать параллельно (разные файлы, нет конфликтов).

## Final acceptance

- Changes split into independently reviewable PRs; no PR mixes toolchain-wide formatting with runtime behavior
- Каждый P1 имеет regression test
- Все обязательные checks завершены до merge (Step 0)
- Baseline SHA документирован, известные failing/pending checks перечислены
- Финальный отчёт различает: исправленные дефекты, осознанные policy decisions, отложенные продуктовые функции