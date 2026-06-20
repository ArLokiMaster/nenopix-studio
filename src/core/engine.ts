import fs from "fs-extra";
import path from "path";

import {
  GenerateOptions,
  GenerateResult,
  BatchJob,
} from "../types/index.js";
import { registry } from "./provider-registry.js";
import { promptAgent } from "./prompt-agent.js";
import { pluginManager } from "./plugin-manager.js";
import { config } from "../storage/config.js";
import { v4 as uuidv4 } from "uuid";

export class ImageForgeEngine {
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    // Resolve provider
    const providerId = options.provider || config.get("defaultProvider");
    const provider = registry.get(providerId);

    if (!provider) {
      return {
        success: false,
        images: [],
        provider: providerId,
        model: options.model || "unknown",
        prompt: options.prompt,
        duration: 0,
        error: `Provider "${providerId}" not found. Run: imageforge providers`,
      };
    }

    const configured = await provider.isConfigured();
    if (!configured) {
      return {
        success: false,
        images: [],
        provider: providerId,
        model: options.model || "unknown",
        prompt: options.prompt,
        duration: 0,
        error: `Provider "${providerId}" is not configured. Run: imageforge config`,
      };
    }

    // Resolve model
    if (!options.model) {
      options.model = config.get("defaultModel");
    }

    // Apply defaults
    if (!options.size) options.size = config.get("defaultSize");
    if (!options.quality) options.quality = config.get("defaultQuality");
    if (!options.format) options.format = config.get("defaultFormat");

    let outputDir = options.outputDir || config.get("outputDir");
    // Guard against bare drive roots (e.g. "d:", "d:\") which cannot be mkdir'd
    if (/^[a-zA-Z]:[/\\]?$/.test(outputDir.trim())) {
      outputDir = path.join(outputDir.replace(/[/\\]+$/, ""), "nenopix-output");
    }
    options.outputDir = outputDir;

    // Ensure output dir exists
    await fs.ensureDir(options.outputDir);

    // Prompt enhancement
    const shouldEnhance =
      options.enhance !== false &&
      (options.enhance === true || config.get("enhancePrompts"));

    if (shouldEnhance) {
      const result = await promptAgent.enhance(options.prompt, {
        targetProvider: providerId,
        style: options.style,
        quality: options.quality,
      });
      options.enhancedPrompt = result.enhanced;
    }

    // Run beforeGenerate hooks
    options = await pluginManager.runHook("beforeGenerate", options);

    // Generate
    let result = await provider.generate(options);

    // Run afterGenerate hooks
    result = await pluginManager.runHook("afterGenerate", result);

    return result;
  }

  async batch(
    prompts: string[],
    options: Omit<GenerateOptions, "prompt">,
    onProgress?: (current: number, total: number, result: GenerateResult) => void
  ): Promise<BatchJob> {
    const job: BatchJob = {
      id: uuidv4(),
      prompts,
      options,
      status: "running",
      results: [],
      progress: 0,
      startedAt: new Date(),
    };

    for (let i = 0; i < prompts.length; i++) {
      const result = await this.generate({ ...options, prompt: prompts[i] });
      job.results.push(result);
      job.progress = Math.round(((i + 1) / prompts.length) * 100);

      if (onProgress) {
        onProgress(i + 1, prompts.length, result);
      }
    }

    job.status = job.results.every((r) => r.success) ? "completed" : "failed";
    job.completedAt = new Date();
    return job;
  }

  async generateFromFile(
    filePath: string,
    options: Omit<GenerateOptions, "prompt">,
    onProgress?: (current: number, total: number, result: GenerateResult) => void
  ): Promise<BatchJob> {
    const content = await fs.readFile(filePath, "utf-8");
    const prompts = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));

    return this.batch(prompts, options, onProgress);
  }
}

export const engine = new ImageForgeEngine();
