---
description: Orchestrates Go PRs. Enforces tests, runs strict reviews, mandates local 'make check', enforces git rebasing, and generates the final AI-disclosure PR template.
---

# Ultimate Open-Source Contribution Workflow

**Trigger:** When the user types `/go-os-workflow`, execute the following steps sequentially. Stop immediately if any step fails.

### Step 1: Planning & Branch Hygiene
- Ask the user for the target issue number. (Remind the user: substantial features should be discussed in an issue first).
- Verify the current branch is branched off `main` and uses a descriptive name (e.g., `fix/...`, `feat/...`, `docs/...`).
- Explicitly brainstorm 3-5 edge cases.
- **CRITICAL:** Pause for user approval.

### Step 2: Execution & Test Enforcement
- Write the core logic and tests.
- Ensure the code addresses the edge cases from Step 1.
- Keep the scope small. Suggest splitting the PR if it starts to exceed a few hundred lines across multiple files.

### Step 3: AI Review Gauntlet
- Automatically invoke `@system-architect` and `@tech-debt-janitor` to ensure simplicity and remove over-engineered AI artifacts.
- Automatically invoke `@perf-optimizer` to check for race conditions and suggest `sync.RWMutex` where appropriate.
- Automatically invoke `@code-review-ai` to verify standard Go idioms and imperative commit messaging.
- Automatically invoke `@security-auditor` to check for path traversal, sandbox escapes, and command execution risks.
- **CRITICAL:** If any skill FAILS, halt the workflow immediately.

### Step 4: Local Validation Gate
- Automatically run `make check` locally to verify dependencies, formatting (`fmt`), static analysis (`vet`), and tests before proceeding.
- If `make check` fails, the agent must attempt to fix the issues or report them to the user.

### Step 5: Mandatory Change Report & Review
- **CRITICAL:** Perform a final review of all changes across all modified files.
- Generate a "Change Report" containing:
  - **Summary of Logic Changes**: Concise bullet points explaining *what* was changed and *why*.
  - **Review Highlights**: Mention any specific performance or security considerations addressed.
  - **Verification Status**: Confirm that `make check` passed and all edge cases are covered.
- **NEVER** propose `git add`, `git commit`, or `git push` in this message.
- **PAUSE** and explicitly ask the user: *"Does this logic meet your expectations? Shall we proceed to Git operations?"*

### Step 6: Git Operations & Hygiene
- Once confirmed, instruct the user to squash minor cleanups or typo fixes into a single commit.
- Instruct the user to rebase their branch onto upstream main (`git fetch upstream`, `git rebase upstream/main`).
- Generate the final commit message following Step 3 guidelines.

### Step 7: PR Template Generation
- Generate a summary of the atomic changes.
- Generate a Markdown PR description using this exact structure:
  - **Description:** What does this change do and why?
  - **Type of Change:** (Bug fix, feature, docs, or refactor)
  - **🤖 AI Code Generation:** Classify as [🤖 Fully AI-generated | 🛠️ Mostly AI-generated | 👨‍💻 Mostly Human-written] and explicitly state: *"I have read, understood, and tested this code for correctness and security."*
  - **Related Issue:** Link the issue (e.g., `Fixes #123`).
  - **Test Environment:** Prompt the user to fill in the hardware, OS, and models used.