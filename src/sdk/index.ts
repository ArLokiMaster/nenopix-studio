/**
 * Nenopix SDK
 * Use Nenopix as a library in your Node.js applications
 *
 * @example
 * import { Nenopix } from 'nenopix-studio/sdk';
 *
 * const forge = new Nenopix({
 *   provider: 'gemini',
 *   apiKeys: { gemini: process.env.NENOPIX_GEMINI_API_KEY }
 * });
 *
 * const result = await forge.generate('a futuristic city at sunset');
 * console.log(result.images[0].path);
 */

import { engine } from "../core/engine.js";
import { registry } from "../core/provider-registry.js";
import { promptAgent } from "../core/prompt-agent.js";
import { pluginManager } from "../core/plugin-manager.js";
import { credentialStore } from "../storage/credentials.js";
import { config } from "../storage/config.js";
import {
  GenerateOptions,
  GenerateResult,
  BatchJob,
  EnhancementOptions,
  EnhancedPrompt,
  ProviderInfo,
  ModelInfo,
  ImageForgePlugin,
  ImageForgeSDKOptions,
} from "../types/index.js";

export class Nenopix {
  constructor(options: ImageForgeSDKOptions = {}) {
    // Apply API keys if provided
    if (options.apiKeys) {
      for (const [provider, key] of Object.entries(options.apiKeys)) {
        credentialStore.set(provider, { apiKey: key });
      }
    }

    if (options.provider) {
      config.set("defaultProvider", options.provider);
    }
    if (options.model) {
      config.set("defaultModel", options.model);
    }
    if (options.outputDir) {
      config.set("outputDir", options.outputDir);
    }
    if (options.enhance !== undefined) {
      config.set("enhancePrompts", options.enhance);
    }
  }

  /**
   * Generate images from a text prompt
   */
  async generate(
    prompt: string,
    options: Partial<Omit<GenerateOptions, "prompt">> = {}
  ): Promise<GenerateResult> {
    return engine.generate({ ...options, prompt });
  }

  /**
   * Generate multiple images from different prompts
   */
  async batch(
    prompts: string[],
    options: Partial<Omit<GenerateOptions, "prompt">> = {},
    onProgress?: (current: number, total: number, result: GenerateResult) => void
  ): Promise<BatchJob> {
    return engine.batch(prompts, options, onProgress);
  }

  /**
   * Generate from a text file of prompts (one per line)
   */
  async batchFromFile(
    filePath: string,
    options: Partial<Omit<GenerateOptions, "prompt">> = {}
  ): Promise<BatchJob> {
    return engine.generateFromFile(filePath, options);
  }

  /**
   * Enhance a prompt using the AI agent
   */
  async enhance(
    prompt: string,
    options: EnhancementOptions = {}
  ): Promise<EnhancedPrompt> {
    return promptAgent.enhance(prompt, options);
  }

  /**
   * List all available providers
   */
  async providers(): Promise<ProviderInfo[]> {
    return registry.getAllInfo();
  }

  /**
   * List models for a specific provider
   */
  async models(providerId: string): Promise<ModelInfo[]> {
    const provider = registry.get(providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);
    return provider.listModels();
  }

  /**
   * Test connection to a provider
   */
  async test(providerId: string): Promise<{ success: boolean; message: string }> {
    const provider = registry.get(providerId);
    if (!provider) return { success: false, message: `Provider "${providerId}" not found` };
    return provider.testConnection();
  }

  /**
   * Register a custom plugin
   */
  async use(plugin: ImageForgePlugin): Promise<void> {
    if (plugin.providers) {
      for (const { factory } of plugin.providers) {
        registry.register(factory());
      }
    }
  }

  /**
   * Get available style presets for prompt enhancement
   */
  getStylePresets(): string[] {
    return promptAgent.getStylePresets();
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return config.getAll();
  }
}

// Named exports for direct use
export { engine, registry, promptAgent, pluginManager, credentialStore, config, Nenopix as ImageForge };

// Type exports
export type {
  GenerateOptions,
  GenerateResult,
  BatchJob,
  EnhancementOptions,
  EnhancedPrompt,
  ProviderInfo,
  ModelInfo,
  ImageForgePlugin,
  ImageForgeSDKOptions,
};
