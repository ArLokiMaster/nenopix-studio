#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import updateNotifier from "update-notifier";
import { printBanner, printMini } from "../ui/banner.js";
import { makeGenerateCommand } from "./commands/generate.js";
import { makeProvidersCommand } from "./commands/providers.js";
import { makeModelsCommand } from "./commands/models.js";
import { makeConfigCommand } from "./commands/config.js";
import { makePluginCommand } from "./commands/plugin.js";
import { makeUICommand } from "./commands/ui.js";
import { runSetupWizard } from "./wizard.js";
import { runInteractive } from "./interactive.js";
import { config } from "../storage/config.js";
import { pluginManager } from "../core/plugin-manager.js";
import { promptAgent } from "../core/prompt-agent.js";
import { registry } from "../core/provider-registry.js";

// Load package.json for version
const pkg = require("../../package.json");

async function main(): Promise<void> {
  // Check for updates
  updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 }).notify();

  // Load plugins
  await pluginManager.loadAll();

  // Handle post-install
  if (process.argv.includes("--post-install")) {
    console.log(chalk.green("\n✓ Nenopix Studio CLI installed successfully!\n"));
    console.log(chalk.white('Run ') + chalk.cyan('nenopix') + chalk.white(' to get started.\n'));
    return;
  }

  const program = new Command();

  program
    .name("nenopix")
    .description(
      chalk.cyan("⚡ Nenopix Studio CLI") +
        " — Unified AI Image Generation Platform\n" +
        chalk.gray("  Providers: OpenAI · Gemini · Stability AI · Replicate · HuggingFace · Flux")
    )
    .version(pkg.version, "-v, --version", "Show version number")
    .option("--no-banner", "Suppress banner on launch")
    .option("--json", "Global JSON output mode");

  // Register commands
  program.addCommand(makeGenerateCommand());
  program.addCommand(makeProvidersCommand());
  program.addCommand(makeModelsCommand());
  program.addCommand(makeConfigCommand());
  program.addCommand(makePluginCommand());
  program.addCommand(makeUICommand());

  // ─── Standalone Commands ─────────────────────────────────────────────────

  // Quick enhance command
  program
    .command("enhance <prompt>")
    .description("Preview AI-enhanced version of a prompt")
    .option("--provider <id>", "Target provider for optimization")
    .option("--style <preset>", "Style preset to apply")
    .option("--json", "JSON output")
    .action(async (prompt: string, opts: any) => {
      const result = await promptAgent.enhance(prompt, {
        targetProvider: opts.provider,
        style: opts.style,
      });

      if (opts.json || config.get("jsonOutput")) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.gray("\n  Original : ") + chalk.white(result.original));
      console.log(chalk.gray("  Enhanced : ") + chalk.cyan(result.enhanced));
      if (result.styleKeywords.length) {
        console.log(chalk.gray("  Style    : ") + chalk.dim(result.styleKeywords.join(", ")));
      }
      console.log();
    });

  // Status command
  program
    .command("status")
    .description("Show system status and configured providers")
    .option("--json", "JSON output")
    .action(async (opts: any) => {
      const providers = await registry.getAllInfo();
      const configuredCount = providers.filter((p) => p.status === "available").length;

      if (opts.json || config.get("jsonOutput") || process.argv.includes("--json")) {
        console.log(
          JSON.stringify({
            version: pkg.version,
            providers,
            configuredCount,
            config: config.getAll(),
          }, null, 2)
        );
        return;
      }

      console.log(chalk.bold.white("\n  Nenopix Studio CLI Status\n"));
      console.log(chalk.gray("  Version          : ") + chalk.white(pkg.version));
      console.log(chalk.gray("  Configured       : ") + chalk.white(`${configuredCount}/${providers.length} providers`));
      console.log(chalk.gray("  Default provider : ") + chalk.cyan(config.get("defaultProvider")));
      console.log(chalk.gray("  Default model    : ") + chalk.cyan(config.get("defaultModel")));
      console.log(chalk.gray("  Output dir       : ") + chalk.white(config.get("outputDir")));
      console.log(chalk.gray("  Config file      : ") + chalk.dim(config.configPath));
      console.log();
    });

  // ─── Default action: interactive TUI when no sub-command given ───────────
  program.action(async (opts) => {
    if (!config.isSetupComplete) {
      printBanner();
      await runSetupWizard();
    } else {
      await runInteractive();
    }
  });

  // Show banner for generate command
  const args = process.argv.slice(2);
  const isGenerate = args[0] === "generate" || args[0] === "g";
  const isJson = args.includes("--json");
  const noBanner = config.get("noBanner") || args.includes("--no-banner");

  if (!isJson && !noBanner && isGenerate) {
    printMini();
  }

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(chalk.red("Fatal error:"), err.message);
  if (process.env.IMAGEFORGE_VERBOSE === "true") {
    console.error(err.stack);
  }
  process.exit(1);
});
