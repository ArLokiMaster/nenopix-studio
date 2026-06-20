import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { config } from "../../storage/config.js";
import { runSetupWizard } from "../wizard.js";
import { printSuccess, printDivider } from "../../ui/banner.js";
import { AppConfig } from "../../types/index.js";

export function makeConfigCommand(): Command {
  const cmd = new Command("config");

  cmd
    .alias("cfg")
    .description("View or edit Nenopix Studio CLI configuration")
    .option("--setup", "Re-run the interactive setup wizard")
    .option("--reset", "Reset all settings to defaults")
    .option("--json", "Output config as JSON")
    .option("--path", "Show config file path")
    .action(async (opts: any) => {
      if (opts.setup) {
        await runSetupWizard(true);
        return;
      }

      if (opts.reset) {
        const { confirm } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirm",
            message: "Reset all configuration to defaults?",
            default: false,
          },
        ]);
        if (confirm) {
          config.reset();
          printSuccess("Configuration reset to defaults");
        }
        return;
      }

      if (opts.path) {
        console.log(config.configPath);
        return;
      }

      const cfg = config.getAll();

      if (opts.json) {
        console.log(JSON.stringify(cfg, null, 2));
        return;
      }

      printDivider("Current Configuration");
      console.log();

      const entries: [string, string][] = [
        ["Default Provider", cfg.defaultProvider],
        ["Default Model", cfg.defaultModel],
        ["Default Size", cfg.defaultSize],
        ["Default Quality", cfg.defaultQuality],
        ["Default Format", cfg.defaultFormat],
        ["Output Directory", cfg.outputDir],
        ["Enhance Prompts", cfg.enhancePrompts ? "enabled" : "disabled"],
        ["Enhancement Engine", cfg.enhanceProvider],
        ["JSON Output", cfg.jsonOutput ? "enabled" : "disabled"],
        ["Setup Complete", cfg.setupComplete ? "yes" : "no"],
      ];

      for (const [key, val] of entries) {
        console.log(
          chalk.gray(`  ${key.padEnd(22)}: `) + chalk.white(val)
        );
      }

      if (cfg.installedPlugins.length > 0) {
        console.log(
          chalk.gray(`  ${"Plugins".padEnd(22)}: `) +
            chalk.white(cfg.installedPlugins.join(", "))
        );
      }

      console.log();
      console.log(chalk.dim(`  Config file: ${config.configPath}`));
      console.log();
    });

  // Set a specific config value
  cmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action((key: string, value: string) => {
      const boolKeys = ["enhancePrompts", "jsonOutput", "verbose", "noBanner"];
      const typedValue: any = boolKeys.includes(key)
        ? value === "true"
        : value;

      try {
        config.set(key as keyof AppConfig, typedValue);
        printSuccess(`Set ${key} = ${value}`);
      } catch {
        console.log(chalk.red(`Unknown config key: ${key}`));
        process.exit(1);
      }
    });

  // Interactive config editor
  cmd
    .command("edit")
    .description("Interactively edit configuration")
    .action(async () => {
      printDivider("Edit Configuration");
      console.log();

      const answers = await inquirer.prompt([
        {
          type: "list",
          name: "defaultProvider",
          message: "Default provider:",
          choices: ["openai", "gemini", "stability", "replicate", "huggingface", "openai-compat"],
          default: config.get("defaultProvider"),
        },
        {
          type: "input",
          name: "defaultModel",
          message: "Default model ID:",
          default: config.get("defaultModel"),
        },
        {
          type: "list",
          name: "defaultSize",
          message: "Default image size:",
          choices: ["256x256", "512x512", "1024x1024", "1792x1024", "1024x1792"],
          default: config.get("defaultSize"),
        },
        {
          type: "list",
          name: "defaultQuality",
          message: "Default quality:",
          choices: ["draft", "standard", "hd", "ultra"],
          default: config.get("defaultQuality"),
        },
        {
          type: "input",
          name: "outputDir",
          message: "Output directory:",
          default: config.get("outputDir"),
        },
        {
          type: "confirm",
          name: "enhancePrompts",
          message: "Auto-enhance prompts?",
          default: config.get("enhancePrompts"),
        },
      ]);

      for (const [key, value] of Object.entries(answers)) {
        config.set(key as keyof AppConfig, value as any);
      }

      printSuccess("Configuration updated");
    });

  return cmd;
}
