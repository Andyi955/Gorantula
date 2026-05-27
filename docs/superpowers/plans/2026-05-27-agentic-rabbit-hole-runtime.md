# Agentic Rabbit Hole Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rabbit Hole's normal crawl internals with a native Gorantula agentic research runtime.

**Architecture:** Rabbit Hole keeps the existing Spider Console UI, but the backend runs a Rabbit-specific loop: plan tool tasks, execute web/vault/timeline tools, write clickable live provisional nodes, run a Gatekeeper, then finalize with the existing relationship/discovery workflow once. The runtime stays Go-native and treats outside frameworks as inspiration rather than new dependencies.

**Tech Stack:** Go backend, existing NervousSystem legs, existing model provider router, React/Vitest frontend.

---

### Task 1: Agentic Rabbit Types And Tests

**Files:**
- Modify: `models/models.go`
- Modify: `brain/rabbit_hole_test.go`
- Create: `brain/rabbit_hole_agentic.go`

- [x] Add failing tests for sanitized Rabbit tool plans, provisional node metadata, vault memory search, and timeline context extraction.
- [x] Add `RabbitState`, `RabbitTool`, `RabbitPass`, and `Confidence` metadata to `models.MemoryNode`.
- [x] Implement focused helper functions that can be tested without network access.

### Task 2: Rabbit Tool Runtime

**Files:**
- Modify: `brain/rabbit_hole.go`
- Modify: `brain/rabbit_hole_agentic.go`

- [x] Plan tool tasks using the configured model and safe fallback tasks.
- [x] Execute `web_search`, `vault_search`, and `timeline_context` tasks.
- [x] Maintain an evidence ledger across passes and use it in Gatekeeper prompts.
- [x] Broadcast live provisional nodes as `MEMORY_NODE_GATHERED` before final synthesis.
- [x] Promote provisional nodes when Rabbit Hole finishes.

### Task 3: Frontend Provisional Node States

**Files:**
- Modify: `frontend/src/components/CustomNode.tsx`
- Modify: `frontend/src/components/DetectiveBoard.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/tests/components/CustomNode.test.tsx`
- Modify: `frontend/tests/components/DetectiveBoard.test.tsx`

- [x] Render provisional Rabbit nodes as clickable real nodes with `RABBIT TRAIL` state.
- [x] Handle Rabbit node promotion updates in visible and cached board state.
- [x] Keep relationship synthesis ignoring provisional churn until final completion.

### Task 3b: Browser QA Replay

**Files:**
- Modify: `frontend/src/utils/browserQaSeed.ts`
- Modify: `frontend/src/components/DetectiveBoard.tsx`
- Modify: `frontend/tests/browserQaSeed.test.ts`
- Modify: `frontend/tests/components/DetectiveBoard.test.tsx`

- [x] Add a browser-only Rabbit Hole trail replay event.
- [x] Add a QA menu action that creates provisional Rabbit Trail nodes.
- [x] Promote the QA nodes and add relationships without backend socket messages.

### Task 4: Validation

**Files:**
- Modify tests as needed.

- [x] Run focused backend tests: `go test ./brain ./models ./internal/app`.
- [x] Run focused frontend tests: `npm.cmd run test -- --run tests/App.test.tsx tests/components/CustomNode.test.tsx tests/components/DetectiveBoard.test.tsx`.
- [x] Run full validation: `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test`, `go test ./...`.
