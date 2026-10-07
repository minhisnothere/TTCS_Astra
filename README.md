<div align="center">

# 🛡️ Astra - AI Pentesting Framework

**Autonomous Multi-Agent AI Pentester for Web Applications**

Astra is an advanced, autonomous Multi-Agent AI security framework that analyzes source code, maps attack surfaces, and executes real-world exploits to validate vulnerabilities before they reach production.

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

</div>

---

## 🎯 Overview

Astra replaces rigid, rule-based scanners with a highly adaptable Multi-Agent AI architecture. Powered by **Temporal Workflows** for fault-tolerance, Astra orchestrates multiple AI agents that simulate the mindset of a human penetration tester. 

The framework operates in a specialized 5-phase kill-chain:

1. **Pre-Recon & Recon**: Dynamically maps the target's attack surface, endpoints, and technology stack.
2. **Agentic SAST (Capella Engine)**: A rigorous 10-step static analysis pipeline where the AI reviews source code, traces data flows, and self-critiques to eliminate false positives.
3. **Vulnerability Reconciliation**: Merges runtime endpoints with SAST findings to prioritize highly exploitable paths.
4. **Autonomous Exploitation**: Safely executes generated payloads (via `curl` and `bash`) within a sandboxed environment. Features dynamic **batching** and **feedback loops** to continuously refine payloads until a vulnerability is confirmed.
5. **Reporting**: Compiles comprehensive executive summaries and raw technical evidence into standard markdown reports.

## ✨ Key Features

- **Multi-Agent Orchestration**: Specialized agents for Recon, Vulnerability Analysis, Exploitation, and Reporting.
- **Resilient Workflows**: Built on `Temporal`, ensuring that network failures, API rate limits (e.g., HTTP 429), or LLM context overflows are automatically caught, backed-off, and retried without losing progress.
- **Complex Kill-Chains**: Capable of executing multi-step attacks (e.g., Second-order SQLi requiring account registration, session hijacking, and payload injection).
- **Local-First Design**: Runs the orchestration locally. Uses Docker to isolate the execution environment and safeguard your host machine.
- **LLM Agnostic**: Supports OpenAI-compatible endpoints (including custom gateways like Mirai API, Anthropic, or Local LLMs via Ollama).

## 🚀 Quick Start

### Prerequisites

- **Docker**: Required to run the isolated worker sandbox safely.
- **Node.js 18+ & pnpm**: Required for building and running the CLI.
- **API Key**: Access to an OpenAI-compatible API or custom LLM gateway.

### 1. Build the Project

Clone the repository and build the system:

```bash
# Install Node dependencies
pnpm install

# Build the CLI and Worker source
pnpm run build

# Build the isolated Docker worker image
docker build -t astra-worker:latest .
```

### 2. Configure Environment

Copy the example environment file and add your credentials:

```bash
cp .env.example .env
```

Edit `.env` to include your API Key and preferred model. For example:

```env
ASTRA_AI_API_KEY=your_api_key_here
ASTRA_AI_MODEL=gpt-4o # Or your custom model string (e.g. mirai:gpt-5.6-sol)
```

*(Note: Never commit your `.env` file to version control. Astra is configured to ignore it by default).*

### 3. Run a Scan

To start an autonomous scan, run the `./astra start` command from the root directory.

```bash
ASTRA_FORWARD_HOSTS=false ./astra start \
  -u "https://target-application.local" \
  -r "/path/to/target/source-code/" \
  -w "scan-session-01" \
  --models-config "./models.json" \
  --keep-container \
  --follow
```

**Options:**
- `-u, --url`: The live target application URL.
- `-r, --repo`: Absolute path to the target's source code directory (mounted read-only).
- `-w, --workspace`: A unique session name. Logs, state, and reports are saved in `workspaces/<workspace-name>`.
- `--models-config`: Path to your custom models configuration.
- `--follow`: Stream the workflow execution logs in real-time.
- `--keep-container`: Keep the Docker container alive for post-scan debugging.

## 📂 Project Structure

Astra uses a Domain-Driven Design (DDD) architecture:

```text
astra/
├── apps/
│   ├── cli/             # Astra CLI entry points and command logic
│   └── worker/          # Core Temporal worker and Multi-Agent system
│       ├── src/
│       │   ├── temporal/# Orchestration DAG (workflows & activities)
│       │   ├── ai/      # Pi Runtime (LLM translations), Capella SAST, Tooling
│       │   └── services/# Wrappers for external tooling (Bash, File I/O)
├── workspaces/          # Auto-generated isolated sessions (logs, deliverables)
└── docker-compose.yml   # Infrastructure setup (Temporal Server & Worker)
```

## ⚠️ Disclaimer & Ethical Use

**Astra actively executes real exploits.** 
This tool is designed **strictly for authorized penetration testing, security research, and educational purposes**. Run this tool ONLY against applications and environments you explicitly own or have written authorization to test. Do not run Astra against unauthorized production systems. 

The authors and contributors are not responsible for any misuse, damage, or legal consequences caused by the use of this software. By using Astra, you agree to adhere to all applicable local, state, and international laws.
