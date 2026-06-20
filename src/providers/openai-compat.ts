import axios from "axios";
import {
  ProviderInfo,
  ModelInfo,
  GenerateOptions,
  GenerateResult,
  GeneratedImage,
} from "../types/index.js";
import { AbstractProvider } from "./base.js";
import { credentialStore } from "../storage/credentials.js";

export class OpenAICompatProvider extends AbstractProvider {
  readonly id = "openai-compat";
  readonly info: ProviderInfo = {
    id: "openai-compat",
    name: "OpenAI-Compatible API",
    description: "Any API following OpenAI's image generation spec (Together, Groq, local AUTOMATIC1111, etc.)",
    website: "https://platform.openai.com/docs/api-reference/images",
    models: [],
    status: "unconfigured",
    requiresApiKey: false,
    freetier: true,
    features: ["text-to-image", "batch"],
  };

  async isConfigured(): Promise<boolean> {
    const creds = credentialStore.get("openai-compat");
    return !!(creds?.baseUrl);
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const creds = credentialStore.get("openai-compat");
    if (!creds?.baseUrl) return { success: false, message: "Base URL not configured" };

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (creds.apiKey) headers.Authorization = `Bearer ${creds.apiKey}`;

      await axios.get(`${creds.baseUrl}/models`, { headers, timeout: 10000 });
      return { success: true, message: `Connected to ${creds.baseUrl}` };
    } catch (err: any) {
      // Some local servers don't have /models but still work
      if (err.response?.status === 404) {
        return { success: true, message: `Endpoint reachable (no /models route)` };
      }
      return { success: false, message: err.message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const creds = credentialStore.get("openai-compat");
    if (!creds?.baseUrl) return [];

    try {
      const headers: Record<string, string> = {};
      if (creds.apiKey) headers.Authorization = `Bearer ${creds.apiKey}`;

      const res = await axios.get(`${creds.baseUrl}/models`, {
        headers,
        timeout: 10000,
      });

      return (res.data?.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
        description: m.description || "Custom model",
        maxSize: "1024x1024",
        sizes: ["512x512", "1024x1024"],
      }));
    } catch {
      return [
        {
          id: "custom-model",
          name: "Custom Model",
          description: "Default model for this endpoint",
          maxSize: "1024x1024",
          sizes: ["512x512", "1024x1024"],
        },
      ];
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const creds = credentialStore.get("openai-compat");

    if (!creds?.baseUrl) {
      return this.errorResult(options, options.model || "custom", "Base URL not configured", startTime);
    }

    const model = options.model || "custom-model";
    const prompt = options.enhancedPrompt || options.prompt;
    const count = options.count || 1;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (creds.apiKey) headers.Authorization = `Bearer ${creds.apiKey}`;

      const res = await axios.post(
        `${creds.baseUrl}/images/generations`,
        {
          model,
          prompt,
          n: count,
          size: options.size || "1024x1024",
          response_format: "b64_json",
        },
        { headers, timeout: 120000 }
      );

      const images: GeneratedImage[] = [];
      const { width, height } = this.parseSize(options.size || "1024x1024");

      for (let i = 0; i < res.data.data.length; i++) {
        const item = res.data.data[i];
        const b64 = item.b64_json || item.base64;
        const url = item.url;

        if (b64) {
          const savedPath = await this.saveImage(b64, options, i, true);
          images.push({
            id: this.makeImageId(),
            path: savedPath,
            base64: b64,
            width,
            height,
            format: options.format || "png",
            metadata: {},
          });
        } else if (url) {
          const buffer = await this.downloadImage(url);
          const savedPath = await this.saveImage(buffer, options, i);
          images.push({
            id: this.makeImageId(),
            path: savedPath,
            url,
            width,
            height,
            format: options.format || "png",
            metadata: {},
          });
        }
      }

      return this.buildResult(options, model, images, startTime, prompt);
    } catch (err: any) {
      return this.errorResult(
        options, model,
        err.response?.data?.error?.message || err.message,
        startTime
      );
    }
  }
}
