import chalk from "chalk";
import figlet from "figlet";

export function printBanner(): void {
  const banner = figlet.textSync("Nenopix", {
    font: "ANSI Shadow",
    horizontalLayout: "default",
    verticalLayout: "default",
  });

  console.log(chalk.cyan(banner));
  console.log(
    chalk.gray("  ") +
    chalk.bold.white("Unified AI Image Generation Platform") +
    chalk.gray("  —  ") +
    chalk.yellow("CLI v1.0.0")
  );
  console.log(
    chalk.gray("  Providers: OpenAI · Gemini · Stability · Replicate · HuggingFace · Flux\n")
  );
}

export function printMini(): void {
  console.log(
    chalk.cyan.bold("⚡ Nenopix") +
    chalk.gray(" CLI  ") +
    chalk.dim("v1.0.0")
  );
}

export function printDivider(label?: string): void {
  const line = "─".repeat(60);
  if (label) {
    const pad = Math.floor((60 - label.length - 2) / 2);
    const left = "─".repeat(pad);
    const right = "─".repeat(60 - pad - label.length - 2);
    console.log(chalk.gray(`${left} ${chalk.white(label)} ${right}`));
  } else {
    console.log(chalk.gray(line));
  }
}

export function printSuccess(msg: string): void {
  console.log(chalk.green("✓ ") + chalk.white(msg));
}

export function printError(msg: string): void {
  console.log(chalk.red("✗ ") + chalk.white(msg));
}

export function printWarning(msg: string): void {
  console.log(chalk.yellow("⚠ ") + chalk.white(msg));
}

export function printInfo(msg: string): void {
  console.log(chalk.blue("ℹ ") + chalk.gray(msg));
}
