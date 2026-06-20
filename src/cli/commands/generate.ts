import { Command } from "commander";
import chalk from "chalk";
import fs from "fs-extra";
import inquirer from "inquirer";
import { engine } from "../../core/engine.js";
import { GenerateOptions } from "../../types/index.js";
import { config } from "../../storage/config.js";
import { createSpinner } from "../../ui/terminal.js";
import { printGenerateResult, printProgress } from "../../ui/terminal.js";

export function makeGenerateCommand(): Command {
  const cmd = new Command("generate");

  cmd
    .alias("g")
    .description("Generate images from a text prompt")
    .argument("[prompt]", "Image generation prompt")
    .option("-p, --provider <id>", "AI provider to use")
    .option("-m, --model <id>", "Model to use")
    .option("-s, --size <WxH>", "Image size (e.g., 1024x1024, 1792x1024)")
    .option("-q, --quality <level>", "Quality: draft | standard | hd | ultra")
    .option("--style <preset>", "Style preset: photorealistic | cinematic | anime | concept | watercolor | 3d | minimal | dark")
    .option("-n, --count <number>", "Number of images to generate", parseInt)
    .option("-o, --output <dir>", "Output directory")
    .option("--prefix <name>", "Output filename prefix")
    .option("--format <fmt>", "Output format: png | jpg | webp")
    .option("--seed <number>", "Seed for reproducibility", parseInt)
    .option("-e, --enhance", "Enhance prompt with AI agent")
    .option("--no-enhance", "Disable prompt enhancement")
    .option("--negative <prompt>", "Negative prompt (what to avoid)")
    .option("-r, --reference <path>", "Reference image path")
    .option("-b, --batch <file>", "Batch mode: text file with one prompt per line")
    .option("--steps <number>", "Inference steps (provider-dependent)", parseInt)
    .option("--cfg <number>", "CFG scale / guidance scale", parseFloat)
    .option("--json", "Output results as JSON")
    .action(async (promptArg: string | undefined, opts: any) => {
      const jsonMode = opts.json || config.get("jsonOutput");

      // ─── Batch mode ────────────────────────────────────────────────────────
      if (opts.batch) {
        if (!fs.existsSync(opts.batch)) {
          if (!jsonMode) console.log(chalk.red(`✗ Batch file not found: ${opts.batch}`));
          else console.log(JSON.stringify({ error: `File not found: ${opts.batch}` }));
          process.exit(1);
        }

        const options: Omit<GenerateOptions, "prompt"> = {
          provider: opts.provider,
          model: opts.model,
          size: opts.size,
          quality: opts.quality,
          style: opts.style,
          count: opts.count,
          outputDir: opts.output,
          outputPrefix: opts.prefix,
          format: opts.format,
          seed: opts.seed,
          enhance: opts.enhance,
          negativePrompt: opts.negative,
          referenceImage: opts.reference,
          steps: opts.steps,
          cfgScale: opts.cfg,
          json: jsonMode,
        };

        if (!jsonMode) {
          console.log(chalk.cyan(`\n⚡ Batch mode — reading from ${opts.batch}\n`));
        }

        const spinner = jsonMode ? null : createSpinner("Running batch...");
        spinner?.start();

        const job = await engine.generateFromFile(
          opts.batch,
          options,
          (current, total, result) => {
            if (!jsonMode) {
              spinner?.stop();
              printProgress(current, total, result.prompt.substring(0, 40) + "...");
              if (result.success && result.images[0]?.path) {
                console.log(chalk.green(`  ✓ [${current}/${total}]`) + chalk.gray(` → ${result.images[0].path}`));
              } else if (!result.success) {
                console.log(chalk.red(`  ✗ [${current}/${total}]`) + chalk.gray(` ${result.error}`));
              }
            }
          }
        );

        spinner?.stop();

        if (jsonMode) {
          console.log(JSON.stringify(job, null, 2));
        } else {
          const succeeded = job.results.filter((r) => r.success).length;
          const failed = job.results.length - succeeded;
          console.log(chalk.green(`\n✓ Batch complete: ${succeeded} succeeded, ${failed} failed`));
        }
        return;
      }

      // ─── Single generation ──────────────────────────────────────────────────
      let prompt = promptArg;

      if (!prompt) {
        const { p } = await inquirer.prompt([
          {
            type: "input",
            name: "p",
            message: "Enter your image prompt:",
            validate: (v: string) => v.trim().length > 0 || "Prompt cannot be empty",
          },
        ]);
        prompt = p;
      }

      const options: GenerateOptions = {
        prompt: prompt!,
        provider: opts.provider,
        model: opts.model,
        size: opts.size,
        quality: opts.quality,
        style: opts.style,
        count: opts.count,
        outputDir: opts.output,
        outputPrefix: opts.prefix,
        format: opts.format,
        seed: opts.seed,
        enhance: opts.enhance !== false,
        negativePrompt: opts.negative,
        referenceImage: opts.reference,
        steps: opts.steps,
        cfgScale: opts.cfg,
        json: jsonMode,
      };

      if (!jsonMode) {
        const providerLabel = opts.provider || config.get("defaultProvider");
        const modelLabel = opts.model || config.get("defaultModel");
        console.log();
        console.log(chalk.gray("  Prompt   : ") + chalk.white(prompt!));
        console.log(chalk.gray("  Provider : ") + chalk.cyan(providerLabel));
        console.log(chalk.gray("  Model    : ") + chalk.cyan(modelLabel));
        console.log(chalk.gray("  Size     : ") + chalk.white(opts.size || config.get("defaultSize")));
        console.log();
      }

      const spinner = jsonMode ? null : createSpinner("Generating image...");
      spinner?.start();

      const result = await engine.generate(options);
      spinner?.stop();

      printGenerateResult(result, jsonMode);

      if (!result.success) process.exit(1);
    });

  return cmd;
}
