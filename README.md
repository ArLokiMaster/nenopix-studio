# ⚡ Nenopix Studio

> Unified AI Image Generation CLI, REST API, & Model Context Protocol (MCP) Server for AI Agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/yourname/nenopix-studio/pulls)
[![MCP Server](https://img.shields.io/badge/MCP-Server-blue.svg)](https://modelcontextprotocol.io)

```
  ███╗   ██╗███████╗███╗   ██╗ ██████╗ ██████╗ ██╗██╗  ██╗
  ████╗  ██║██╔════╝████╗  ██║██╔═══██╗██╔══██╗██║╚██╗██╔╝
  ██╔██╗ ██║█████╗  ██╔██╗ ██║██║   ██║██████╔╝██║ ╚███╔╝ 
  ██║╚██╗██║██╔══╝  ██║╚██╗██║██║   ██║██╔═══╝ ██║ ██╔██╗ 
  ██║ ╚████║███████╗██║ ╚████║╚██████╔╝██║     ██║██╔╝ ██╗
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝
```

**Nenopix Studio** is an advanced open-source AI image generation factory. It provides a **single unified interface** to generate, batch, and enhance images using every major AI provider (Google Gemini, OpenAI DALL-E, Stability AI, Replicate FLUX, HuggingFace, and OpenAI-compatible endpoints).

It functions as:
1. 💻 **A Powerful CLI** (`nenopix`) for rapid terminal-based generation and batch rendering.
2. 🤖 **An MCP Server** that lets AI assistants (like Claude, Cursor, and Windsurf) use image generation as native tools.
3. 🌐 **A Web UI & REST API** for full visual control and web application workflows.

---

## 🚀 One-Command Install & Run

Get up and running instantly on Windows, macOS, or Linux. The installation script installs dependencies, builds the TypeScript code, verifies configuration, and launches the Web UI automatically.

### Windows (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### macOS / Linux (Bash)
```bash
bash scripts/install.sh
```

*Or manual install:*
```bash
npm install && npm run build && npm link
```

---

## 🛠️ MCP Server Configuration
Bring image generation tools natively into your AI coding agent.

### Claude Desktop
Add this to your configuration (located in `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "nenopix": {
      "command": "node",
      "args": [
        "d:/nenopix-studio/dist/server/mcp.js"
      ],
      "env": {
        "NENOPIX_GEMINI_API_KEY": "YOUR_GEMINI_API_KEY_HERE",
        "NENOPIX_OPENAI_API_KEY": "YOUR_OPENAI_API_KEY_HERE"
      }
    }
  }
}
```

### Cursor & Windsurf
1. Navigate to **Cursor Settings** -> **Beta Features** -> **MCP**.
2. Click **+ Add New MCP Server**.
3. Name: `nenopix`.
4. Type: `stdio`.
5. Command: `node d:/nenopix-studio/dist/server/mcp.js`.

---

## 💻 CLI Quick Start

Once installed globally, use the `nenopix` binary to generate images:

```bash
# First run — launches interactive setup wizard
nenopix

# Generate an image with default provider
nenopix generate "a futuristic city at sunset"

# Specify a provider and model
nenopix generate "dragon in a forest" --provider gemini --model gemini-2.0-flash-preview-image-generation

# Generate with visual styles, high quality, and specific size
nenopix generate "portrait of a knight" --style cinematic --quality hd --size 1024x1792

# Generate multiple images in batch mode
nenopix generate "abstract art" --count 4 --output ./my-images

# Preview an AI-enhanced prompt
nenopix enhance "cute cat" --style anime
```

---

## 📊 Commands Reference

| Command | Alias | Description |
|---------|-------|-------------|
| `nenopix` | | Launch setup wizard (first run) or show help |
| `nenopix generate "prompt"` | `g` | Generate images |
| `nenopix providers` | `p` | List all providers and their status |
| `nenopix providers add <id>` | | Add/update provider credentials |
| `nenopix providers test <id>` | | Test a provider connection |
| `nenopix models [provider]` | `m` | List available models |
| `nenopix config` | `cfg` | View current configuration |
| `nenopix config --setup` | | Re-run setup wizard |
| `nenopix config edit` | | Interactive config editor |
| `nenopix config set <key> <val>` | | Set a config value |
| `nenopix enhance "prompt"` | | Preview AI-enhanced prompt |
| `nenopix status` | | Show system status |
| `nenopix plugin install <name>` | | Install a provider plugin |

---

## 🔌 Unified Providers List

| Provider | ID | Free Tier | Best For |
|----------|----|-----------|----|
| **Google Gemini** | `gemini` | ✅ 1500/day | Getting started, free usage (Imagen 3) |
| **OpenAI** | `openai` | ❌ Paid | Highest quality, DALL·E 3 |
| **Stability AI** | `stability` | ❌ Paid | Professional, Stable Diffusion 3 |
| **Replicate** | `replicate` | ❌ Pay-per-use | FLUX models, open-source models |
| **HuggingFace** | `huggingface` | ✅ Rate-limited | Open-source models |
| **Custom API** | `openai-compat` | Depends | Local AUTOMATIC1111, LM Studio, etc. |

---

## ⚙️ Environment Variables

Add these to your system environment or a `.env` file in the root to configure Nenopix Studio:

```bash
# API Keys (Nenopix namespace)
NENOPIX_OPENAI_API_KEY=sk-...
NENOPIX_GEMINI_API_KEY=AIza...
NENOPIX_STABILITY_API_KEY=sk-...
NENOPIX_REPLICATE_API_KEY=r8_...
NENOPIX_HUGGINGFACE_API_KEY=hf_...

# Legacy fallback environment keys are also supported:
# IMAGEFORGE_GEMINI_API_KEY, IMAGEFORGE_OPENAI_API_KEY, etc.

# Custom OpenAI-compatible endpoints
NENOPIX_OPENAI_COMPAT_BASE_URL=http://localhost:7860/v1
NENOPIX_OPENAI_COMPAT_API_KEY=any-key

# Output Defaults
NENOPIX_DEFAULT_PROVIDER=gemini
NENOPIX_DEFAULT_MODEL=gemini-2.0-flash-preview-image-generation
NENOPIX_DEFAULT_SIZE=1024x1024
NENOPIX_DEFAULT_QUALITY=standard
NENOPIX_OUTPUT_DIR=./images
```

---

## 📦 SDK Integration

Integrate Nenopix Studio directly into your Node.js or TypeScript codebases:

```typescript
import { ImageForge } from 'nenopix-studio/sdk';

const forge = new ImageForge({
  provider: 'gemini',
  apiKeys: {
    gemini: process.env.NENOPIX_GEMINI_API_KEY!,
  },
  outputDir: './generated',
  enhance: true,
});

// Single generation
const result = await forge.generate('a mountain at sunset', {
  size: '1024x1024',
  quality: 'hd',
  style: 'photorealistic',
});

console.log(result.images[0].path);
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) - free to use, modify, and distribute for personal and commercial purposes.
