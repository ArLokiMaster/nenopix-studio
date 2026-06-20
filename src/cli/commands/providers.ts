import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { registry } from "../../core/provider-registry.js";
import { credentialStore } from "../../storage/credentials.js";
import { printProvidersTable } from "../../ui/terminal.js";
import { printDivider, printSuccess, printError } from "../../ui/banner.js";
import { config } from "../../storage/config.js";

export function makeProvidersCommand(): Command {
  const cmd = new Command("providers");

  cmd
    .alias("p")
    .description("List and manage AI image providers")
    .option("--json", "Output as JSON")
    .action(async (opts: any) => {
      const providers = await registry.getAllInfo();

      if (opts.json || config.get("jsonOutput") || process.argv.includes("--json")) {
        console.log(JSON.stringify(providers, null, 2));
        return;
      }

      console.log(chalk.bold.white("\n  Available Providers\n"));
      printProvidersTable(providers);

      const configured = providers.filter((p) => p.status === "available").length;
      console.log(
        chalk.gray(`  ${configured}/${providers.length} providers configured. `) +
          chalk.dim("Run: nenopix config --provider <id> to configure one.\n")
      );
    });

  // Test a specific provider
  cmd
    .command("test <id>")
    .description("Test connection to a provider")
    .action(async (id: string) => {
      const provider = registry.get(id);
      if (!provider) {
        printError(`Provider "${id}" not found`);
        process.exit(1);
      }

      process.stdout.write(chalk.gray(`Testing ${provider.info.name}... `));
      const result = await provider.testConnection();

      if (result.success) {
        console.log(chalk.green("✓ " + result.message));
      } else {
        console.log(chalk.red("✗ " + result.message));
      }
    });

  // Add provider credential
  cmd
    .command("add <id>")
    .description("Add or update credentials for a provider")
    .action(async (id: string) => {
      const provider = registry.get(id);
      if (!provider) {
        printError(`Provider "${id}" not found. Available: ${registry.list().join(", ")}`);
        process.exit(1);
      }

      const info = provider.info;
      printDivider(`Configure ${info.name}`);
      console.log(chalk.gray(`\n${info.description}`));
      console.log(chalk.dim(`API key: ${chalk.cyan(info.website)}\n`));

      if (id === "openai-compat") {
        const answers = await inquirer.prompt([
          {
            type: "input",
            name: "baseUrl",
            message: "API Base URL:",
            validate: (v) => (v.startsWith("http") ? true : "Must be a valid URL"),
          },
          {
            type: "password",
            name: "apiKey",
            message: "API Key (leave blank if not required):",
            mask: "*",
          },
        ]);
        credentialStore.set("openai-compat", {
          baseUrl: answers.baseUrl,
          apiKey: answers.apiKey || undefined,
        });
      } else {
        const { apiKey } = await inquirer.prompt([
          {
            type: "password",
            name: "apiKey",
            message: `${info.name} API Key:`,
            mask: "*",
          },
        ]);
        credentialStore.set(id, { apiKey: apiKey.trim() });
      }

      process.stdout.write(chalk.gray("Testing connection... "));
      const test = await provider.testConnection();
      if (test.success) {
        printSuccess(test.message);
        credentialStore.markTested(id, true);
      } else {
        printError(test.message);
        credentialStore.markTested(id, false);
      }
      console.log();
    });

  // Remove provider credential
  cmd
    .command("remove <id>")
    .description("Remove credentials for a provider")
    .action(async (id: string) => {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Remove credentials for "${id}"?`,
          default: false,
        },
      ]);
      if (confirm) {
        credentialStore.remove(id);
        printSuccess(`Credentials for "${id}" removed`);
      }
    });

  return cmd;
}
