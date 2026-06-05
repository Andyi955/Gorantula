# Gorantula

Gorantula is a local-first intelligence research workspace. It crawls a topic, gathers evidence, synthesizes it with configurable AI providers, and turns the result into a forensic board, timeline, and searchable vault.

## Preview

![Spider View Preview](./public/assets/dashboard-v4.png)
![Detective Board Preview](./public/assets/detectiveboard.png)
![Timeline Preview](./public/assets/timeline-v2.png)

## What It Does

- Runs concurrent web crawling with multiple worker legs.
- Supports Web, Local, and Rabbit Hole crawl modes from Spider View.
- Builds an interactive Detective Board from gathered evidence.
- Extracts deterministic, board-derived events into the Timeline View.
- Archives successful investigations into the local `abdomen_vault`.
- Lets you interrogate archived evidence through Vault Chat.
- Supports discovery review, relationship mapping, draggable graph labels, and source-linked evidence cards.
- Adds a Rabbit Hole mode for deeper pass-based research, Gatekeeper review, optional image scraping, supporting evidence bands, and final relationship synthesis.
- Uses configurable AI routing with DeepSeek as the default day-to-day provider.
- Supports Gemini, OpenAI, Anthropic, Qwen, GLM, Kimi, MiniMax, Ollama, LM Studio, and compatible `/v1/chat/completions` providers.

![Rabbit Hole Spider View Preview](./public/assets/rabbitholedashboard.png)

## Rabbit Hole Mode

Rabbit Hole is the deep-investigation crawl mode. It starts from Spider View, creates or continues an investigation, and runs agentic research passes that can combine fresh web searches, saved-vault echoes, timeline context, and optional image scraping.

- `Guided` runs a pass, shows the Gatekeeper recommendation, then waits for the operator to continue or stop.
- `Max Descent` continues automatically until the Gatekeeper stops or the hard pass cap is reached.
- Rabbit Hole nodes are marked on the board and promoted after the descent finishes.
- Relationship synthesis and board cleanup run once at the end, so the board does not churn after every pass.
- Relevant unconnected Rabbit Hole evidence is kept in a compact Supporting Evidence layer instead of being hidden or deleted.
- Rabbit Hole runs write detailed traces under `abdomen_vault/rabbit-hole-logs`.

## Tech Stack

- Backend: Go, Gorilla WebSockets
- Frontend: React, TypeScript, Vite, Tailwind CSS
- Graphs: React Flow, Dagre
- 3D view: React Three Fiber / Three.js
- Search: Brave Search API
- Storage: local browser persistence plus backend vault files

## Prerequisites

- Go 1.21 or newer
- Node.js 18 or newer
- npm
- Brave Search API key
- DeepSeek API key, unless you configure another provider in Settings

Optional local providers:

- Ollama at `http://localhost:11434`
- LM Studio at `http://localhost:1234/v1`

## Quick Start

From the repository root:

```powershell
go mod download
Copy-Item .env.example .env
```

Install frontend dependencies:

```powershell
cd frontend
npm.cmd install
```

Start the backend from the repository root:

```powershell
go run ./cmd/gorantula
```

The backend runs at:

```text
http://127.0.0.1:8080
```

Start the frontend from `frontend`:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://127.0.0.1:5173/
```

## Environment Setup

Create `.env` from `.env.example`, then add at least:

```env
BRAVE_API_KEY=your_brave_api_key
GORANTULA_HOST=127.0.0.1
GORANTULA_PORT=8080
DEEPSEEK_ENABLED=true
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-flash
DEFAULT_SEARCH_MODEL=deepseek
DEFAULT_PERSONA_MODEL=deepseek
```

Optional provider switches:

```env
GEMINI_ENABLED=false
OPENAI_ENABLED=false
ANTHROPIC_ENABLED=false
DASHSCOPE_ENABLED=false
ZHIPUAI_ENABLED=false
MOONSHOT_ENABLED=false
MINIMAX_ENABLED=false
OLLAMA_ENABLED=false
LMSTUDIO_ENABLED=false
```

Provider keys and local hosts:

```env
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DASHSCOPE_API_KEY=
ZHIPUAI_API_KEY=
MOONSHOT_API_KEY=
MINIMAX_API_KEY=
OLLAMA_HOST=http://localhost:11434
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LM_API_TOKEN=
```

Model overrides:

```env
GEMINI_MODEL=gemini-3-flash-preview
OPENAI_MODEL=gpt-5.4-mini
ANTHROPIC_MODEL=claude-sonnet-4-6
DASHSCOPE_MODEL=qwen3.6-plus
ZHIPUAI_MODEL=glm-5-turbo
MOONSHOT_MODEL=kimi-k2.6
MINIMAX_MODEL=MiniMax-M2.7-highspeed
OLLAMA_MODEL=qwen3-coder
LMSTUDIO_MODEL=qwen3.6
```

Provider switches are separate from credentials. Set `*_ENABLED=true` only for providers you want Gorantula to route to.

## Daily Development Commands

Backend:

```powershell
go run ./cmd/gorantula
go test ./...
```

Frontend:

```powershell
cd frontend
npm.cmd run dev -- --host 127.0.0.1 --port 5173
npm.cmd run test
npm.cmd run build
```

On Windows, the first backend start may trigger a Windows Defender Firewall prompt. Allowing private-network access is expected for local development.

## Workflow

1. Open Spider View, pick `Web`, `Local`, or `Rabbit Hole`, and enter a research topic.
2. Watch the worker legs gather sources and evidence.
3. For Rabbit Hole, choose `Guided` or `Max Descent` and review Gatekeeper decisions as the run deepens.
4. Open Detective Board to inspect evidence cards, supporting evidence, and relationships.
5. Use Connect the Dots to synthesize relationships when a normal crawl is complete; Rabbit Hole runs trigger final synthesis automatically.
6. Open Timeline View and generate or refresh the timeline from saved board evidence.
7. Use Vault Chat to select archived evidence files and ask grounded questions.
8. Review generated markdown reports in `abdomen_vault`.

## Project Notes

- Timeline generation is manual and local to the selected investigation.
- Vault Chat answers are scoped to the selected vault evidence files.
- Browser persistence is used for fast local investigation switching.
- Backend vault files provide durable markdown archives for completed investigations.
- Discovery debug traces are written under `abdomen_vault/discovery_logs`.
- Rabbit Hole debug traces are written under `abdomen_vault/rabbit-hole-logs`.

## Troubleshooting

- If the frontend opens on `localhost` instead of `127.0.0.1`, use:

  ```powershell
  npm.cmd run dev -- --host 127.0.0.1 --port 5173
  ```

- If Vault Chat cannot load files, confirm the backend is running at `http://127.0.0.1:8080`.
- If searches fail, check `BRAVE_API_KEY`.
- If AI calls fail, check that the matching provider has both `*_ENABLED=true` and a valid key or local host.
- If a board or timeline looks stale, refresh the active investigation data from the UI before re-running analysis.
