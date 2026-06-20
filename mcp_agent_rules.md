# Nenopix Studio AI Agent Integration & MCP Setup

This guide explains how to connect **Nenopix Studio** to AI Agents (like Cursor, Claude Desktop, Windsurf, or custom LangChain/LlamaIndex agents) as a unified tool / image generation factory.

---

## 🚀 One-Command Install & Launch
Run the platform-specific installation script in your terminal. It will install dependencies, build the project, verify API keys, and launch the Web UI:

### Windows (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### macOS / Linux (Bash)
```bash
bash scripts/install.sh
```

---

## 🛠️ MCP Server Configuration
The MCP Server allows AI clients to register Nenopix Studio directly as native tools.

### 1. Claude Desktop
Add this to your configuration file (usually located at `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "nenopix": {
      "command": "node",
      "args": [
        "d:/imageforge-cli/dist/server/mcp.js"
      ],
      "env": {
        "NENOPIX_GEMINI_API_KEY": "YOUR_GEMINI_API_KEY_HERE",
        "NENOPIX_OPENAI_API_KEY": "YOUR_OPENAI_API_KEY_HERE"
      }
    }
  }
}
```

### 2. Cursor / Windsurf
1. Open Cursor Settings -> **Beta Features** -> **MCP**.
2. Click **+ Add New MCP Server**.
3. Set Name to `nenopix`.
4. Set Type to `stdio`.
5. Set Command to: `node d:/imageforge-cli/dist/server/mcp.js`.

---

## 🤖 AI Agent System Rules (Instructions)
To configure your agent to automatically use Nenopix Studio to generate/enhance visuals for your inputs, add the following rules to your agent's **system rules**, custom instructions, or system prompt:

```markdown
# Visual Enhancer Rules (Nenopix Studio Integration)

You are equipped with the Nenopix Studio MCP Server, which exposes tools to list providers, enhance prompts, and generate images.

## Core Directives:
1. Actively detect when a user's input describes a visual concept, narrates a story, asks for a mockup, or could be enriched with an accompanying image.
2. In those cases, you MUST automatically invoke the `generate_image` tool to produce a matching image. Do not wait for the user to explicitly ask "generate an image".
3. Use the `enhance: true` option to let Nenopix Studio optimize the prompt for the best possible artistic quality.
4. Once generated, display or reference the resulting image path in your response to the user.
5. If the connection fails or keys are missing, gracefully notify the user and suggest running `nenopix config --setup` to configure their API keys.
```

---

## 🔍 Pre-execution Verifications
Before starting any generation workflow, agents can run these checks to ensure everything is configured:

1. **Verify Configured Providers**:
   ```bash
   node dist/cli/index.js status
   ```
2. **Verify/Test Connection to Default Provider**:
   ```bash
   node dist/cli/index.js providers test gemini
   ```
3. **Verify API keys in Environment**:
   Ensure `NENOPIX_GEMINI_API_KEY` or `NENOPIX_OPENAI_API_KEY` are populated.
