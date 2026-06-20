import { Command } from "commander";
import chalk from "chalk";
import { registry } from "../../core/provider-registry.js";
import { printModelsTable } from "../../ui/terminal.js";
import { printError } from "../../ui/banner.js";
import { config } from "../../storage/config.js";

export function makeModelsCommand(): Command {
  const cmd = new Command("models");

  cmd
    .alias("m")
    .description("List available models for all or a specific provider")
    .argument("[provider]", "Provider ID (optional — shows all)")
    .option("--json", "Output as JSON")
    .action(async (providerId: string | undefined, opts: any) => {
      const jsonMode = opts.json || config.get("jsonOutput") || process.argv.includes("--json");

      if (providerId) {
        const provider = registry.get(providerId);
        if (!provider) {
          printError(`Provider "${providerId}" not found. Run: nenopix providers`);
          process.exit(1);
        }

        const models = await provider.listModels();

        if (jsonMode) {
          console.log(JSON.stringify({ provider: providerId, models }, null, 2));
          return;
        }

        printModelsTable(models, providerId);
      } else {
        // Show all providers
        const all = registry.getAll();

        if (jsonMode) {
          const result: Record<string, any> = {};
          for (const p of all) {
            result[p.id] = await p.listModels();
          }
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        for (const provider of all) {
          const models = await provider.listModels();
          if (models.length > 0) {
            printModelsTable(models, provider.id);
          }
        }

        console.log(
          chalk.gray("  Specify a provider to see details: ") +
          chalk.cyan("nenopix models openai\n")
        );
      }
    });

  return cmd;
}
