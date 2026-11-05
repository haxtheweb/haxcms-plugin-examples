# AGENTS.md (answer-guard)

## Purpose
Speed bumps against automated answering of question blocks on private course sites: no answer key in what learners receive, grading on the server, slower brute force, scripted input filtered, flags for instructors. Not a lock.

## Rules
- Never put an answer, correct flag or choice feedback in a response to a learner, or in rendered output on a protected site. `answerGuardCheck` says only correct or not, plus the feedback for the chosen options.
- Editors and admins always get authored content unchanged (the editor needs the answers).
- Only change live renders (`mode: dynamic`); preview and static publish keep authored HTML.
- Keep the front-end API of question elements unchanged; the companion element change is opt-in on `data-answer-guard-key`.
- Never flag keyboard-only answering or anything assistive technology produces; real input is trusted input.
- Store integrity signals only when something is flagged.
- Node and PHP must produce identical output, including the fingerprint keys.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/answer-guard`.

## Diagnose
- Answers still visible: the site has an open license and `protect` is `auto`; or the page was loaded from its raw file (see README, not done here).
- Every check returns 404: the page was saved before the plugin was enabled and enable did not run; re-enable or re-save the page.
- Questions always "incorrect": the question element lacks the `question-check-request` change and graded locally without its answers.
