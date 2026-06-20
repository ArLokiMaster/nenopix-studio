import inquirer from "inquirer";
import chalk from "chalk";
import path from "path";
import os from "os";
import open from "open";
import { registry } from "../core/provider-registry.js";
import { engine } from "../core/engine.js";
import { promptAgent } from "../core/prompt-agent.js";
import { pluginManager } from "../core/plugin-manager.js";
import { config } from "../storage/config.js";
import { printBanner, printDivider, printSuccess, printError, printInfo } from "../ui/banner.js";
import { createSpinner } from "../ui/terminal.js";

export async function runInteractive(): Promise<void> {
  while (true) {
    console.clear();
    printBanner();

    const configured = await registry.getConfiguredProviders();

    if (configured.length === 0) {
      console.log(
        chalk.yellow("  ⚠  No providers configured. ") +
        chalk.dim("Select Configure below to add an API key.\n")
      );
    } else {
      const names = configured.map((p) => chalk.green(p.info.name)).join(chalk.gray("  ·  "));
      console.log(chalk.gray("  Connected: ") + names + "\n");
    }

    printDivider();
    console.log();

    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "  🎨  Generate an image", value: "generate" },
          { name: "  🌐  Launch Web UI  " + chalk.dim("(visual studio interface)"), value: "webui" },
          { name: "  📋  Browse generations", value: "browse" },
          { name: "  ⚙️   Configure providers & settings", value: "configure" },
          { name: "  ✨  Enhance a prompt", value: "enhance" },
          { name: "  🔌  Manage plugins", value: "plugins" },
          { name: "  ❓  Help", value: "help" },
          new (inquirer as any).Separator(),
          { name: "  ✕   Exit", value: "exit" },
        ],
        pageSize: 12,
      },
    ]);

    if (action === "exit") break;

    if (action === "webui") {
      await launchWebUI();
      break;
    }

    if (action === "generate") await interactiveGenerate(configured);
    else if (action === "configure") await interactiveConfigure();
    else if (action === "browse") await interactiveBrowse();
    else if (action === "enhance") await interactiveEnhance();
    else if (action === "plugins") await interactivePlugins();
    else if (action === "help") showHelp();

    if (!["exit", "webui"].includes(action)) {
      console.log();
      await inquirer.prompt([
        {
          type: "input",
          name: "_",
          message: chalk.dim("Press Enter to return to menu..."),
        },
      ]);
    }
  }
}

// ── Generate flow ──────────────────────────────────────────────────────────────

async function interactiveGenerate(configured: any[]): Promise<void> {
  console.clear();
  printDivider("Generate Image");
  console.log();

  if (configured.length === 0) {
    printError("No providers configured. Go to Configure → Add Provider first.");
    return;
  }

  // 1. Provider
  const { providerId } = await inquirer.prompt([
    {
      type: "list",
      name: "providerId",
      message: "Choose a provider:",
      choices: configured.map((p) => ({
        name:
          chalk.green("✓ ") +
          chalk.bold(p.info.name) +
          chalk.dim("  " + (p.info.costPerImage || "varies")) +
          (p.info.freetier ? chalk.green("  Free tier") : ""),
        value: p.id,
      })),
      default: config.get("defaultProvider"),
    },
  ]);

  // 2. Model
  const provider = registry.get(providerId)!;
  const models = await provider.listModels();

  const { modelId } = await inquirer.prompt([
    {
      type: "list",
      name: "modelId",
      message: "Choose a model:",
      choices: models.map((m) => ({
        name:
          (m.recommended ? chalk.yellow("★ ") : "  ") +
          chalk.bold(m.name) +
          chalk.dim("  " + (m.costPerImage || "varies")),
        value: m.id,
      })),
      default: models.find((m) => m.recommended)?.id,
    },
  ]);

  // 3. Prompt
  const { prompt } = await inquirer.prompt([
    {
      type: "input",
      name: "prompt",
      message: "Describe your image:",
      validate: (v: string) => v.trim().length > 2 || "Please enter a prompt",
    },
  ]);

  // 4. Options (collapsed into one prompt block for speed)
  const opts = await inquirer.prompt([
    {
      type: "list",
      name: "size",
      message: "Image size:",
      choices: [
        { name: "1024×1024  Square (recommended)", value: "1024x1024" },
        { name: "1792×1024  Landscape 16:9", value: "1792x1024" },
        { name: "1024×1792  Portrait 9:16", value: "1024x1792" },
        { name: "512×512    Small / fast", value: "512x512" },
      ],
      default: config.get("defaultSize"),
    },
    {
      type: "list",
      name: "style",
      message: "Style preset:",
      choices: [
        { name: "None — use prompt as-is", value: "" },
        { name: "📷 Photorealistic", value: "photorealistic" },
        { name: "🎬 Cinematic", value: "cinematic" },
        { name: "✨ Anime", value: "anime" },
        { name: "🎨 Concept Art", value: "concept" },
        { name: "🖌  Watercolor", value: "watercolor" },
        { name: "🧊 3D Render", value: "3d" },
        { name: "◻  Minimal", value: "minimal" },
        { name: "🌑 Dark Fantasy", value: "dark" },
      ],
      default: "",
    },
    {
      type: "list",
      name: "quality",
      message: "Quality:",
      choices: [
        { name: "Standard  — balanced speed & quality", value: "standard" },
        { name: "HD        — higher quality, slower", value: "hd" },
        { name: "Draft     — fastest, lower quality", value: "draft" },
      ],
      default: config.get("defaultQuality"),
    },
    {
      type: "list",
      name: "count",
      message: "How many images?",
      choices: [
        { name: "1 image", value: 1 },
        { name: "2 images", value: 2 },
        { name: "4 images", value: 4 },
      ],
      default: 1,
    },
    {
      type: "confirm",
      name: "enhance",
      message: "Enhance prompt with AI? " + chalk.dim("(adds quality/style keywords)"),
      default: config.get("enhancePrompts"),
    },
  ] as any);

  console.log();

  // 5. Show enhancement preview
  if (opts.enhance) {
    const enhSpinner = createSpinner("Enhancing prompt…");
    enhSpinner.start();
    const enhanced = await promptAgent.enhance(prompt, {
      targetProvider: providerId,
      style: opts.style,
      quality: opts.quality as any,
    });
    enhSpinner.stop();

    if (enhanced.enhanced !== prompt) {
      console.log(chalk.gray("  Original : ") + chalk.dim(prompt));
      console.log(
        chalk.gray("  Enhanced : ") + chalk.italic.white(enhanced.enhanced)
      );
      console.log();
    }
  }

  // 6. Generate
  const spinner = createSpinner(
    `Generating with ${chalk.cyan(provider.info.name)}…`
  );
  spinner.start();

  const result = await engine.generate({
    prompt,
    provider: providerId,
    model: modelId,
    size: opts.size,
    style: opts.style || undefined,
    quality: opts.quality,
    count: opts.count,
    enhance: opts.enhance,
  });

  spinner.stop();
  console.log();

  if (!result.success) {
    printError("Generation failed: " + result.error);
    return;
  }

  printSuccess(
    `Generated ${result.images.length} image(s) in ${(result.duration / 1000).toFixed(1)}s\n`
  );

  result.images.forEach((img, i) => {
    if (img.path) {
      console.log(chalk.gray(`  [${i + 1}]`) + "  " + chalk.white(img.path));
    } else if (img.url) {
      console.log(chalk.gray(`  [${i + 1}]`) + "  " + chalk.blue.underline(img.url));
    }
  });

  if (result.cost) {
    console.log(chalk.gray(`\n  Cost: `) + chalk.yellow(`$${result.cost.toFixed(4)}`));
  }

  console.log();

  // 7. What next?
  const { next } = await inquirer.prompt([
    {
      type: "list",
      name: "next",
      message: "What next?",
      choices: [
        { name: "🔄 Generate again  (same settings)", value: "again" },
        { name: "✏️  New prompt  (keep provider/model)", value: "newprompt" },
        { name: "📁 Open output folder", value: "folder" },
        { name: "🌐 Launch Web UI to view results", value: "webui" },
        { name: "← Main menu", value: "back" },
      ],
    },
  ]);

  if (next === "again") {
    spinner.text = "Generating again…";
    spinner.start();
    await engine.generate({
      prompt,
      provider: providerId,
      model: modelId,
      size: opts.size,
      style: opts.style || undefined,
      quality: opts.quality,
      count: opts.count,
      enhance: opts.enhance,
    });
    spinner.stop();
    printSuccess("Done!");
  } else if (next === "newprompt") {
    await interactiveGenerate(configured);
  } else if (next === "folder") {
    open(config.get("outputDir"));
    printInfo("Opened output folder");
  } else if (next === "webui") {
    await launchWebUI();
  }
}

// ── Sub-flows ──────────────────────────────────────────────────────────────────

async function launchWebUI(): Promise<void> {
  const { startServer } = require("../server/index.js");
  console.log(chalk.cyan("\n  Starting Nenopix Studio Web UI…\n"));
  await startServer(7842, true);
  // Keep process alive
  await new Promise<void>(() => {});
}

async function interactiveConfigure(): Promise<void> {
  const { runSetupWizard } = require("./wizard.js");
  await runSetupWizard(true);
}

async function interactiveBrowse(): Promise<void> {
  const outputDir = config.get("outputDir");
  console.log();
  console.log(chalk.gray("  Output folder: ") + chalk.white(outputDir));
  console.log(
    chalk.gray("  Sessions:      ") +
    chalk.white(path.join(os.homedir(), ".nenopix", "sessions"))
  );
  console.log();

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Browse options:",
      choices: [
        { name: "📁 Open output folder in Explorer", value: "folder" },
        { name: "🌐 Launch Web UI  (full gallery + history)", value: "webui" },
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (action === "folder") open(outputDir);
  if (action === "webui") await launchWebUI();
}

async function interactiveEnhance(): Promise<void> {
  console.log();
  const { prompt } = await inquirer.prompt([
    {
      type: "input",
      name: "prompt",
      message: "Enter a prompt to enhance:",
      validate: (v: string) => v.trim().length > 0 || "Required",
    },
  ]);

  const { style } = await inquirer.prompt([
    {
      type: "list",
      name: "style",
      message: "Apply a style?",
      choices: [
        { name: "None", value: "" },
        { name: "📷 Photorealistic", value: "photorealistic" },
        { name: "🎬 Cinematic", value: "cinematic" },
        { name: "✨ Anime", value: "anime" },
        { name: "🎨 Concept Art", value: "concept" },
      ],
      default: "",
    },
  ]);

  const spinner = createSpinner("Enhancing…");
  spinner.start();
  const result = await promptAgent.enhance(prompt, { style });
  spinner.stop();

  console.log();
  console.log(chalk.gray("  Original  : ") + chalk.dim(prompt));
  console.log(chalk.gray("  Enhanced  : ") + chalk.bold.white(result.enhanced));
  if (result.styleKeywords.length) {
    console.log(
      chalk.gray("  Style tags: ") + chalk.dim(result.styleKeywords.join(", "))
    );
  }
}

async function interactivePlugins(): Promise<void> {
  const installed = config.get("installedPlugins");

  console.log();
  console.log(chalk.bold("  Installed Plugins:\n"));
  if (installed.length === 0) {
    console.log(chalk.gray("  No plugins installed yet.\n"));
  } else {
    installed.forEach((p, i) => {
      console.log(chalk.gray(`  ${i + 1}.`) + "  " + chalk.white(p));
    });
    console.log();
  }

  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: "Plugin options:",
      choices: [
        { name: "+ Install a plugin from npm", value: "install" },
        { name: "← Back", value: "back" },
      ],
    },
  ]);

  if (action === "install") {
    const { name } = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "npm package name:",
        validate: (v: string) => v.trim().length > 0 || "Required",
      },
    ]);

    const spinner = createSpinner(`Installing ${name}…`);
    spinner.start();
    const result = await pluginManager.install(name.trim());
    spinner.stop();

    result.success ? printSuccess(result.message) : printError(result.message);
  }
}

function showHelp(): void {
  console.clear();
  printDivider("Help & Quick Reference");
  console.log();

  console.log(chalk.bold("  CLI Commands:\n"));
  const cmds = [
    ["nenopix", "Interactive menu (this screen)"],
    ["nenopix ui", "Launch Web UI on localhost:7842"],
    ['nenopix generate "prompt"', "Generate directly from CLI"],
    ["nenopix generate --batch file.txt", "Batch from text file"],
    ['nenopix generate "prompt" --json', "Machine-readable output"],
    ["nenopix providers", "List all providers"],
    ["nenopix providers add gemini", "Add Gemini API key"],
    ["nenopix models", "List all models"],
    ["nenopix config", "View current config"],
    ["nenopix config --setup", "Re-run setup wizard"],
    ['nenopix enhance "prompt"', "Preview enhanced prompt"],
  ];
  cmds.forEach(([cmd, desc]) => {
    console.log(
      chalk.cyan(`  ${cmd.padEnd(42)}`) + chalk.dim(desc)
    );
  });

  console.log();
  console.log(chalk.bold("  Get API Keys (free tiers available):\n"));
  [
    ["Gemini (Free · 1500/day)", "aistudio.google.com/app/apikey"],
    ["HuggingFace (Free · rate-limited)", "huggingface.co/settings/tokens"],
    ["OpenAI", "platform.openai.com/api-keys"],
    ["Stability AI", "platform.stability.ai/account/keys"],
    ["Replicate", "replicate.com/account/api-tokens"],
  ].forEach(([name, url]) => {
    console.log(chalk.gray(`  ${name.padEnd(36)}`) + chalk.blue(url));
  });
  console.log();
}
