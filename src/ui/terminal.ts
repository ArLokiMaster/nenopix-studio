import chalk from "chalk";
import ora, { Ora } from "ora";
import { table } from "table";
import { GenerateResult, ProviderInfo, ModelInfo } from "../types/index.js";

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: "cyan",
    spinner: "dots2",
  });
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export function printProvidersTable(providers: ProviderInfo[]): void {
  const header = [
    chalk.bold.cyan("ID"),
    chalk.bold.cyan("Name"),
    chalk.bold.cyan("Status"),
    chalk.bold.cyan("Free Tier"),
    chalk.bold.cyan("Features"),
  ];

  const rows = providers.map((p) => {
    const statusColor =
      p.status === "available"
        ? chalk.green(p.status)
        : p.status === "unconfigured"
        ? chalk.yellow(p.status)
        : chalk.red(p.status);

    return [
      chalk.white(p.id),
      chalk.bold(p.name),
      statusColor,
      p.freetier ? chalk.green("✓") : chalk.gray("✗"),
      chalk.dim(p.features.slice(0, 3).join(", ")),
    ];
  });

  const config = {
    border: {
      topBody: chalk.gray("─"),
      topJoin: chalk.gray("┬"),
      topLeft: chalk.gray("┌"),
      topRight: chalk.gray("┐"),
      bottomBody: chalk.gray("─"),
      bottomJoin: chalk.gray("┴"),
      bottomLeft: chalk.gray("└"),
      bottomRight: chalk.gray("┘"),
      bodyLeft: chalk.gray("│"),
      bodyRight: chalk.gray("│"),
      bodyJoin: chalk.gray("│"),
      joinBody: chalk.gray("─"),
      joinLeft: chalk.gray("├"),
      joinRight: chalk.gray("┤"),
      joinJoin: chalk.gray("┼"),
    },
  };

  console.log(table([header, ...rows], config));
}

export function printModelsTable(models: ModelInfo[], providerId: string): void {
  console.log(chalk.bold.white(`\nModels for ${chalk.cyan(providerId)}:\n`));

  const header = [
    chalk.bold.cyan("ID"),
    chalk.bold.cyan("Name"),
    chalk.bold.cyan("Max Size"),
    chalk.bold.cyan("Cost"),
    chalk.bold.cyan(""),
  ];

  const rows = models.map((m) => [
    chalk.white(m.id),
    chalk.bold(m.name),
    chalk.dim(m.maxSize),
    m.costPerImage ? chalk.yellow(m.costPerImage) : chalk.green("Free"),
    m.recommended ? chalk.cyan("★ recommended") : "",
  ]);

  const config = {
    border: {
      topBody: chalk.gray("─"),
      topJoin: chalk.gray("┬"),
      topLeft: chalk.gray("┌"),
      topRight: chalk.gray("┐"),
      bottomBody: chalk.gray("─"),
      bottomJoin: chalk.gray("┴"),
      bottomLeft: chalk.gray("└"),
      bottomRight: chalk.gray("┘"),
      bodyLeft: chalk.gray("│"),
      bodyRight: chalk.gray("│"),
      bodyJoin: chalk.gray("│"),
      joinBody: chalk.gray("─"),
      joinLeft: chalk.gray("├"),
      joinRight: chalk.gray("┤"),
      joinJoin: chalk.gray("┼"),
    },
  };

  console.log(table([header, ...rows], config));
}

// ─── Result Display ───────────────────────────────────────────────────────────

export function printGenerateResult(result: GenerateResult, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success) {
    console.log(chalk.red("\n✗ Generation failed: ") + chalk.white(result.error));
    return;
  }

  console.log(chalk.green("\n✓ Generation complete!\n"));
  console.log(chalk.gray("  Provider  : ") + chalk.white(result.provider));
  console.log(chalk.gray("  Model     : ") + chalk.white(result.model));
  console.log(chalk.gray("  Duration  : ") + chalk.white(`${(result.duration / 1000).toFixed(2)}s`));

  if (result.cost) {
    console.log(chalk.gray("  Cost      : ") + chalk.yellow(`$${result.cost.toFixed(4)}`));
  }

  if (result.enhancedPrompt && result.enhancedPrompt !== result.prompt) {
    console.log(chalk.gray("\n  Original  : ") + chalk.dim(result.prompt));
    console.log(chalk.gray("  Enhanced  : ") + chalk.italic(result.enhancedPrompt));
  }

  console.log(chalk.gray(`\n  Generated ${result.images.length} image(s):\n`));

  result.images.forEach((img, i) => {
    const label = chalk.cyan(`  [${i + 1}]`);
    if (img.path) {
      console.log(`${label} ${chalk.white(img.path)}`);
    } else if (img.url) {
      console.log(`${label} ${chalk.blue.underline(img.url)}`);
    }
  });

  console.log();
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

export function printProgress(current: number, total: number, label: string): void {
  const pct = Math.floor((current / total) * 100);
  const filled = Math.floor((current / total) * 30);
  const bar = chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(30 - filled));
  process.stdout.write(`\r  ${bar} ${chalk.white(`${pct}%`)} ${chalk.gray(label)}   `);
  if (current === total) process.stdout.write("\n");
}
