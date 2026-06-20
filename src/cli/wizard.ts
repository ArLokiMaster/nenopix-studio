import inquirer from "inquirer";
import chalk from "chalk";
import path from "path";
import os from "os";
import { printBanner, printDivider, printSuccess, printError, printInfo } from "../ui/banner.js";
import { credentialStore } from "../storage/credentials.js";
import { config } from "../storage/config.js";
import { registry } from "../core/provider-registry.js";

interface WizardAnswers {
  providers: string[];
  defaultProvider: string;
  defaultSize: string;
  defaultQuality: string;
  outputDir: string;
  enhancePrompts: boolean;
  enhanceProvider: string;
}

export async function runSetupWizard(force = false): Promise<void> {
  if (config.isSetupComplete && !force) {
    printInfo("Setup already complete. Use --force to re-run.");
    return;
  }

  console.clear();
  printBanner();

  console.log(chalk.white("Welcome to ImageForge CLI!\n"));
  console.log(chalk.gray("This wizard will help you configure your AI image providers.\n"));
  console.log(chalk.dim("You can re-run this wizard anytime with: ") + chalk.cyan("imageforge config --setup\n"));

  printDivider("Step 1: Select Providers");
  console.log(chalk.gray("\nWhich AI image providers do you want to configure?\n"));

  const allProviders = await registry.getAllInfo();

  const { providers } = await inquirer.prompt<{ providers: string[] }>([
    {
      type: "checkbox",
      name: "providers",
      message: "Select providers to configure:",
      choices: allProviders.map((p) => ({
        name: `${chalk.bold(p.name)} ${chalk.dim(`— ${p.description}`)} ${p.freetier ? chalk.green("(Free tier)") : chalk.yellow("(Paid)")}`,
        value: p.id,
        checked: p.id === "gemini",
      })),
    },
  ]);

  if (providers.length === 0) {
    console.log(chalk.yellow("\nNo providers selected. You can add them later with: imageforge config\n"));
  }

  // Configure each selected provider
  for (const providerId of providers) {
    const info = allProviders.find((p) => p.id === providerId)!;
    printDivider(`Configure ${info.name}`);

    console.log(chalk.gray(`\n${info.description}`));
    console.log(chalk.dim(`Get your API key at: ${chalk.cyan(info.website)}\n`));

    if (providerId === "openai-compat") {
      const { baseUrl, apiKey } = await inquirer.prompt([
        {
          type: "input",
          name: "baseUrl",
          message: "API Base URL (e.g., http://localhost:7860/v1):",
          validate: (v) => (v.startsWith("http") ? true : "Must be a valid URL"),
        },
        {
          type: "password",
          name: "apiKey",
          message: "API Key (leave blank if not required):",
          mask: "*",
        },
      ]);
      credentialStore.set("openai-compat", { baseUrl, apiKey: apiKey || undefined });
    } else {
      const { apiKey } = await inquirer.prompt([
        {
          type: "password",
          name: "apiKey",
          message: `${info.name} API Key:`,
          mask: "*",
          validate: (v) => (v.trim().length > 10 ? true : "API key seems too short"),
        },
      ]);
      credentialStore.set(providerId, { apiKey: apiKey.trim() });
    }

    // Test connection
    const provider = registry.get(providerId)!;
    process.stdout.write(chalk.gray("  Testing connection... "));

    const test = await provider.testConnection();
    if (test.success) {
      console.log(chalk.green("✓ " + test.message));
      credentialStore.markTested(providerId, true);
    } else {
      console.log(chalk.red("✗ " + test.message));
      credentialStore.markTested(providerId, false);
      const { retry } = await inquirer.prompt([
        {
          type: "confirm",
          name: "retry",
          message: "Connection failed. Edit API key?",
          default: true,
        },
      ]);
      if (retry) {
        if (providerId !== "openai-compat") {
          const { apiKey } = await inquirer.prompt([
            {
              type: "password",
              name: "apiKey",
              message: `${info.name} API Key (retry):`,
              mask: "*",
            },
          ]);
          credentialStore.set(providerId, { apiKey: apiKey.trim() });
        }
      }
    }

    console.log();
  }

  printDivider("Step 2: Defaults");

  const configuredProviders = await registry.getConfiguredProviders();
  const providerChoices = configuredProviders.length > 0
    ? configuredProviders.map((p) => ({ name: p.info.name, value: p.id }))
    : allProviders.map((p) => ({ name: p.name, value: p.id }));

  const defaults = await inquirer.prompt<WizardAnswers>([
    {
      type: "list",
      name: "defaultProvider",
      message: "Default AI provider:",
      choices: providerChoices,
      default: configuredProviders[0]?.id || "gemini",
    },
    {
      type: "list",
      name: "defaultSize",
      message: "Default image size:",
      choices: [
        { name: "1024×1024 — Square (recommended)", value: "1024x1024" },
        { name: "1792×1024 — Landscape 16:9", value: "1792x1024" },
        { name: "1024×1792 — Portrait 9:16", value: "1024x1792" },
        { name: "512×512 — Small (fast)", value: "512x512" },
      ],
      default: "1024x1024",
    },
    {
      type: "list",
      name: "defaultQuality",
      message: "Default quality:",
      choices: [
        { name: "standard — Balanced speed and quality", value: "standard" },
        { name: "hd — Higher quality (slower, costs more)", value: "hd" },
        { name: "draft — Fastest, lowest quality", value: "draft" },
      ],
      default: "standard",
    },
    {
      type: "input",
      name: "outputDir",
      message: "Output directory for generated images:",
      default: path.join(os.homedir(), "imageforge-output"),
      validate: (v: string) => {
        const trimmed = v.trim();
        // Reject bare drive roots like "d:", "D:", "d:\", "D:/"
        if (/^[a-zA-Z]:[/\\]?$/.test(trimmed)) {
          return `Can't use a bare drive root. Try something like ${trimmed.replace(/[/\\]$/, "")}\\imageforge-output`;
        }
        if (!path.isAbsolute(trimmed)) {
          return "Please enter an absolute path (e.g. D:\\imageforge-output)";
        }
        return true;
      },
      filter: (v: string) => v.trim(),
    },
    {
      type: "confirm",
      name: "enhancePrompts",
      message: "Auto-enhance prompts for better results?",
      default: true,
    },
    {
      type: "list",
      name: "enhanceProvider",
      message: "Prompt enhancement engine:",
      when: (a: Record<string, unknown>) => !!a.enhancePrompts,
      choices: [
        { name: "Rule-based — Fast, always available, no API cost", value: "rule-based" },
        { name: "OpenAI GPT-4o Mini — Best results (uses OpenAI credits)", value: "openai" },
        { name: "Google Gemini — Good results (uses Gemini quota)", value: "gemini" },
      ],
      default: "rule-based",
    },
  ] as any);

  // Save config
  config.set("defaultProvider", defaults.defaultProvider);
  config.set("defaultSize", defaults.defaultSize as any);
  config.set("defaultQuality", defaults.defaultQuality as any);
  config.set("outputDir", defaults.outputDir);
  config.set("enhancePrompts", defaults.enhancePrompts);
  config.set("enhanceProvider", defaults.enhanceProvider || "rule-based");
  config.markSetupComplete();

  printDivider("Setup Complete");
  console.log();
  printSuccess("ImageForge CLI is ready to use!\n");

  console.log(chalk.gray("Quick start:"));
  console.log(chalk.cyan('  imageforge generate "a futuristic city at sunset"'));
  console.log(chalk.cyan("  imageforge models"));
  console.log(chalk.cyan("  imageforge providers\n"));

  console.log(chalk.dim(`Config saved to: ${config.configPath}`));
  console.log();
}
