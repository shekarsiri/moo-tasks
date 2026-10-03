# 4. Changed-file attribution: recorded edits first, declared files under concurrency, git as fallback

* **Status**: ACCEPTED
* **Decision ID**: `dec-8ba875ed`
* **Date**: 2026-10-02
* **Author**: `claude-code@frontend.local:64756` (agent)
* **Tags**: `attribution`, `git`, `hooks`, `evidence`

## Context

Parallel agents in one working tree got each other's files (two tasks completed 1s apart both recorded the same 526 files), because completion credited every file git saw change since the claim.

## Decision

The Claude Code post-edit hook records each edited path in task_file_touches for the claim it belongs to (the session's only claim, else the only claim whose declared files cover the path; ambiguous edits are not recorded). attributeChanges(): with recorded touches, credit only changed files touched or declared; otherwise drop files other live claims touched or declared, and while another agent is working, a task with declared files keeps only those; a lone agent keeps every changed file.

## Rationale & Consequences

Exact where hooks exist, conservative where they do not, unchanged for the common single-agent case. Wrong attribution is worse than missing attribution: edits made through Bash are not seen by the hook and are only credited when declared.
