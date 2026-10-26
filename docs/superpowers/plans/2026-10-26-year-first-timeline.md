# Year-first timeline implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. One focused final review; reuse the permanent work/ui worktree.

**Goal:** Make world-source navigation annual by default, with 1-year/10-year toolbar steps and monthly exploration inside the date popover.

**Architecture:** The existing timeline controls own display granularity and unsubmitted input; the existing builtin clock/document session still owns the actual query month. Core calendar arithmetic, source precision, storage and editor date labels remain unchanged.

**Tech stack:** Existing JavaScript/Core calendar, shared HTML fragment, viewer CSS, Node unit tests and focused Playwright.

**Spec:** User-approved proposal in this chat, 2026-10-26: ordinary arrows 1 year; double arrows 10 years; annual labels; monthly view in the date input; past annual queries use year-end and this year's queries use the current month; preserve detailed source dates.

## Constraints and rulings

- No project date navigation, new state manager, data conversion, GIS work, main merge, push, deployment or packaging.
- Ruling: restore/open an existing view without changing its cursor. If its historical query month is not December, show the actual month basis alongside the year, rather than incorrectly claiming year-end.
- Ruling: monthly steps live in the popover. Selecting the view unit is an uncommitted form choice until Go or a monthly step succeeds; cancel leaves the committed display unit unchanged.
- Ruling: a cancelled/failed/stale query cannot change the displayed date or unit. Rapid steps accumulate pending input; Core handles BCE and the missing year zero.
- Required month label exports retain their semantics for editor/project setup consumers.

## Review focus

1. BCE/CE and extended years, including 10-year steps.
2. Year-end vs current-month mapping and an externally restored midyear cursor.
3. Monthly input, discarded unit changes and switching back to annual view.
4. Rapid, rejected, cancelled or superseded async queries and input-session focus.
5. 320px/mobile landscape layout, icon hit areas and unchanged editor labels.

## Task 1: Controls and UI

Files: shared/frontend/js/modules/timeline-controls.js, shared/frontend/ui/fragments/timeline.html, apps/viewer/css/viewer.css, tests/unit/timeline-controls.test.mjs.

- [x] Add failing unit cases for the annual/current-month policy, monthly view and cancellation.
- [x] Extend the existing owner and fragment; remove superseded toolbar month controls/IDs and update current callers.
- [x] Run timeline and builtin clock unit tests; retain async/focus regression coverage.

## Task 2: Current contracts and focused workflow verification

Files: directly affected browser tests and product HTML tests; generated frontend snapshots through the existing builder only.

- [x] Update affected selectors/expectations while preserving month-specific terrain/view tests.
- [x] Run focused browser coverage for annual/monthly queries, preserved camera/document and narrow layouts.
- [x] Verify viewer/editor generation independently, with a small editor label/control smoke; distinguish actual WebView verification if unavailable.
- [x] One read-only final review and relevant fixes. Task temporary outputs are archived/removed in the completion step.

## Execution ledger

- Base: ccaeaf521abc7d402eb661351cba8b3fa16c9f3b. Local work/ui and origin/work/ui equal main; tracked and untracked worktree clean after fetch.
- Implemented in the existing owner; original query/storage precision and editor month labels remain unchanged.
- User clarification: retain the original native month dropdown UI. Restored data-native-select and common dialog-action/control sizing; no alternate select implementation.
- One final review found Enter interception on the new in-form month buttons. Added a failing keyboard routing regression, fixed the existing handler and verified actual Enter activation in the browser.
- Scoped verification: 19 unit cases, targeted ESLint, PC/320px button fixtures, one real viewer navigation/responsive workflow and one editor Canvas workflow pass. Existing frontend source resolver is used by fixtures. Actual native WebView and usability studies were not run.
- Report/evidence scope: reports/development/ui/year-navigation-20261026. No main merge, application push, deployment or packaging.
