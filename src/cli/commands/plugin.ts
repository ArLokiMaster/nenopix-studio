import { Command } from "commander";
import chalk from "chalk";
import { pluginManager } from "../../core/plugin-manager.js";
import { printSuccess, printError } from "../../ui/banner.js";
import { config } from "../../storage/config.js";
import { table } from "table";

export function makePluginCommand(): Command {
  const cmd = new Command("plugin");

  cmd.description("Manage ImageForge plugins");

  cmd
    .command("install <name>")
    .alias("i")
    .description("Install a plugin from npm")
    .action(async (name: string) => {
      console.log(chalk.cyan(`\n⚡ Installing plugin: ${name}\n`));
      const result = await pluginManager.install(name);
      if (result.success) {
        printSuccess(result.message);
      } else {
        printError(result.message);
        process.exit(1);
      }
      console.log();
    });

  cmd
    .command("uninstall <name>")
    .alias("rm")
    .description("Uninstall a plugin")
    .action(async (name: string) => {
      const result = await pluginManager.uninstall(name);
      if (result.success) {
        printSuccess(result.message);
      } else {
        printError(result.message);
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .alias("ls")
    .description("List installed plugins")
    .option("--json", "Output as JSON")
    .action((opts: any) => {
      const plugins = pluginManager.listLoaded();
      const installed = config.get("installedPlugins");

      if (opts.json || config.get("jsonOutput")) {
        console.log(JSON.stringify({ installed, loaded: plugins }, null, 2));
        return;
      }

      if (installed.length === 0) {
        console.log(chalk.gray("\n  No plugins installed.\n"));
        console.log(
          chalk.dim("  Install a plugin: ") +
            chalk.cyan("imageforge plugin install imageforge-plugin-<name>\n")
        );
        return;
      }

      console.log(chalk.bold.white("\n  Installed Plugins\n"));

      const header = [
        chalk.bold.cyan("Name"),
        chalk.bold.cyan("Version"),
        chalk.bold.cyan("Status"),
        chalk.bold.cyan("Description"),
      ];

      const rows = installed.map((name) => {
        const loaded = pluginManager.getPlugin(name);
        return [
          chalk.white(name),
          loaded ? chalk.green(loaded.version) : chalk.gray("?"),
          loaded ? chalk.green("loaded") : chalk.yellow("not loaded"),
          loaded ? chalk.dim(loaded.description) : chalk.dim("—"),
        ];
      });

      console.log(table([header, ...rows]));
    });

  return cmd;
}
