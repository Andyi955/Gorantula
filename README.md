# GORANTULA v2.0 // ARCHITECT

![Dashboard Preview](./public/assets/dash1.png)

**Gorantula** is a multi-threaded, AI-powered intelligence agent designed to crawl, digest, and visualize complex research topics. By orchestrating a "Nervous System" of concurrent "Legs," it scrapes the web for raw facts and uses Gemini 3 Flash to synthesize connections and visualize them on an interactive detective board.

---

## 🚀 Key Features

- **Concurrent Crawling**: Deploys 8 parallel scraping workers (Legs) to gather information from disparate sources simultaneously.
- **Detective Board**: A React Flow-powered visualization interface that maps gathered intelligence as interactive nodes.
- **Pattern Matching**: "Connect The Dots" feature uses Gemini's analytical reasoning to discover and draw logical links between pieces of evidence.
- **Auto-Layout**: Integrated Dagre graph engine ensuring clean, structured, and non-overlapping board organization.
- **Investigation Persistence**: Manage and save multiple research sessions with full state restoration.
- **Intel Vault**: Every successful crawl is automatically archived as a markdown report in the timestamped `abdomen_vault`.

## 🛠️ Tech Stack

- **Backend**: Go (Gorilla WebSockets, Google GenAI SDK)
- **Frontend**: React, TypeScript, Vite, Tailwind CSS (v4)
- **Visualization**: React Flow, Dagre
- **AI Engine**: Google Gemini 3 Flash
- **Search Engine**: Brave Search API

---

## 📋 Setup Guide

### 1. Prerequisites
- **Go** (1.21+)
- **Node.js** (v18+) & **npm**
- **Brave Search API Key**: [Get it here](https://api.search.brave.com/app/dashboard)
- **Google Gemini API Key**: [Get it here](https://aistudio.google.com/app/apikey)

### 2. Environment Configuration
Create a `.env` file in the root directory (or copy from `.env.example`):
```bash
GEMINI_API_KEY=your_gemini_api_key
BRAVE_API_KEY=your_brave_api_key
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

1. **Initiate Crawl**: Go to the "Spider View" and enter a research topic (e.g., "Future of fusion energy").
2. **Watch the Spider**: Observe the "Nervous System" as it generates sub-queries and dispatches Legs to find nutrients.
3. **Analyze the Board**: Head over to the "Detective Board" tab. Watch as cards "pop in" with AI-generated summaries.
4. **Connect The Dots**: Once gathering is complete (check the status indicator), click the **[ CONNECT THE DOTS ]** button. The board will automatically organize itself into a logical hierarchy and reveal the hidden relationships between facts.
5. **Read Deep**: Click "READ FULL" on any card to slide out the complete Intel Report.
