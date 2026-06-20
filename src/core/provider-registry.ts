import { BaseProvider, ProviderInfo } from "../types/index.js";
import { OpenAIProvider } from "../providers/openai.js";
import { GeminiProvider } from "../providers/gemini.js";
import { StabilityProvider } from "../providers/stability.js";
import { ReplicateProvider } from "../providers/replicate.js";
import { HuggingFaceProvider } from "../providers/huggingface.js";
import { OpenAICompatProvider } from "../providers/openai-compat.js";
import { credentialStore } from "../storage/credentials.js";

class ProviderRegistry {
  private providers: Map<string, BaseProvider> = new Map();

  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    const builtins: BaseProvider[] = [
      new OpenAIProvider(),
      new GeminiProvider(),
      new StabilityProvider(),
      new ReplicateProvider(),
      new HuggingFaceProvider(),
      new OpenAICompatProvider(),
    ];

    for (const p of builtins) {
      this.providers.set(p.id, p);
    }
  }

  register(provider: BaseProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): BaseProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): BaseProvider[] {
    return Array.from(this.providers.values());
  }

  async getInfo(id: string): Promise<ProviderInfo | undefined> {
    const provider = this.providers.get(id);
    if (!provider) return undefined;

    const info = { ...provider.info };
    const configured = await provider.isConfigured();
    info.status = configured ? "available" : "unconfigured";
    return info;
  }

  async getAllInfo(): Promise<ProviderInfo[]> {
    const infos: ProviderInfo[] = [];
    for (const provider of this.providers.values()) {
      const info = { ...provider.info };
      const configured = await provider.isConfigured();
      info.status = configured ? "available" : "unconfigured";
      infos.push(info);
    }
    return infos;
  }

  async getConfiguredProviders(): Promise<BaseProvider[]> {
    const result: BaseProvider[] = [];
    for (const provider of this.providers.values()) {
      if (await provider.isConfigured()) {
        result.push(provider);
      }
    }
    return result;
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const registry = new ProviderRegistry();
