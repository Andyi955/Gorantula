# GORANTULA v2.0 // ARCHITECT

![Dashboard Preview](./public/assets/dash1.png)

**Gorantula** is a multi-threaded, AI-powered intelligence agent designed to crawl, digest, and visualize complex research topics. By orchestrating a "Nervous System" of concurrent "Legs," it scrapes the web for raw facts and uses Gemini 3 Flash or MiniMax to synthesize connections and visualize them on an interactive detective board.

---

## 🚀 Key Features

- **Concurrent Crawling**: Deploys 8 parallel scraping workers (Legs) to gather information from disparate sources simultaneously.
- **Date-Aware AI**: The central Brain contextually limits searches and connects data via chronological relation to the absolute exact current date, ensuring modern timeline accuracy.
- **Robust Multi-Byte Parsing**: Advanced `rune` UTF-8 token handling ensures foreign languages (Chinese, Japanese) parsing is pristine without bytes-truncation corruption.
- **3D WebGL Spider View**: Next-gen visually stunning React Three Fiber data pipeline flow, visualizing live task delegation to parallel worker legs.
- **Detective Board**: A React Flow-powered visualization interface that maps gathered intelligence as interactive nodes with dynamic edge-wiring.
- **Multi-Agent Persona Analysis**: "Connect The Dots" runs 6 specialized AI personas in parallel to analyze evidence from different angles:
  - **Skeptic** — Questions assumptions, finds gaps and contradictions
  - **Connector** — Finds hidden links between different pieces of info
  - **Timeline Analyst** — Orders events chronologically, spots causality
  - **Entity Hunter** — Identifies key people, orgs, and locations
  - **Context Provider** — Adds historical background and explains jargon
  - **Implications Mapper** — Evaluates consequences and predicts outcomes
  Results are synthesized into color-coded relationships between evidence nodes.
- **Color-Coordinated Connections**: Relationships are visualized with distinct colors (`SUPPORTS` green, `OPPOSES` red, `EXPANDS` blue, `DEPENDS` orange, `RELATED` purple) with animated dashed lines for dynamic connections.
- **Multi-Model Support**: Supports both Google Gemini and MiniMax (Coding Plan) for AI analysis, with automatic fallback on API failures.
- **Auto-Layout**: Integrated Dagre graph engine ensuring clean, structured, and non-overlapping board organization.
- **Investigation Persistence**: Fast, popup-free instant-switching between research projects with seamless LocalStorage transitions and marquee UX.
- **Intel Vault**: Every successful crawl is automatically archived as a markdown report in the timestamped `abdomen_vault`.

## 🛠️ Tech Stack

- **Backend**: Go (Gorilla WebSockets, Google GenAI SDK)
- **Frontend**: React, TypeScript, Vite, Tailwind CSS (v4)
- **Visualization**: React Flow, Dagre
- **AI Engine**: Google Gemini 3 Flash + MiniMax M2.5 HighSpeed (with multi-model routing)
- **Search Engine**: Brave Search API

---

## 📋 Setup Guide

### 1. Prerequisites
- **Go** (1.21+)
- **Node.js** (v18+) & **npm** or **pnpm**
- **Brave Search API Key**: [Get it here](https://api.search.brave.com/app/dashboard)
- **Google Gemini API Key**: [Get it here](https://aistudio.google.com/app/apikey)
- **MiniMax API Key (Optional)**: [Get it here](https://platform.minimax.io) - Supports Coding Plan for high-speed inference

### 2. Environment Configuration
Create a `.env` file in the root directory (or copy from `.env.example`):
```bash
GEMINI_API_KEY=your_gemini_api_key
BRAVE_API_KEY=your_brave_api_key
MINIMAX_API_KEY=your_minimax_api_key  # Optional: enables multi-model support
```

### 3. Installation

**Backend Setup:**
```bash
go mod download
```

**Frontend Setup:**
```bash
cd frontend
npm install
```

---

## 🎮 How to Run

### Start the Backend
From the root directory:
```bash
go run main.go
```
The server will start on `localhost:8080`.

### Start the Frontend
From the `frontend` directory:
```bash
npm run dev
```
Open your browser to the local Vite URL (usually `localhost:5173`).

---

## 🕵️ Operation Instructions

1. **Initiate Crawl**: Go to the "Spider View" and enter a research topic (e.g., "Future of fusion energy"). The AI will parse this intelligently using today's exact date.
2. **Watch the WebGL Spider**: Observe the 3D visualizer map out the "Nervous System." You will see 8 distinct worker legs pulse with activity, lock onto targets, and glow as data physically returns to the central core.
3. **Analyze the Board**: Head over to the "Detective Board" tab. Watch as cards "pop in" with AI-generated summaries. You can safely resize cards for a better fit or use the mini-map to overview massive case networks.
4. **Connect The Dots**: Once gathering is complete, click the **[ CONNECT THE DOTS ]** button. The board will automatically organize itself into a logical hierarchy, connecting topics with distinct visual evidence wires (`SUPPORTS` = solid green, `OPPOSES` = dashed red, etc.).
5. **Read Deep**: Click "READ FULL" on any card to slide out the complete Intel Report, fully parsed and untruncated even if in multi-byte languages.
6. **Switch Topics**: Use the fast, popup-free sidebar to rapidly ditch old investigations and swap seamlessly into new cases while monitoring the lower Status Ticker.
