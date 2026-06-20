import axios from "axios";
import {
  ProviderInfo,
  ModelInfo,
  GenerateOptions,
  GenerateResult,
  GeneratedImage,
} from "../types/index.js";
import { AbstractProvider } from "./base.js";

const MODELS: ModelInfo[] = [
  {
    id: "gemini-2.5-flash-image",
    name: "Gemini 2.5 Flash Image",
    description: "Fast, free-tier image generation — great quality",
    maxSize: "1024x1024",
    sizes: ["512x512", "1024x1024"],
    costPerImage: "Free",
    recommended: true,
  },
  {
    id: "gemini-3.1-flash-image",
    name: "Gemini 3.1 Flash Image",
    description: "Latest fast image model with improved quality",
    maxSize: "1024x1024",
    sizes: ["512x512", "1024x1024"],
    costPerImage: "Free",
  },
  {
    id: "gemini-3-pro-image",
    name: "Gemini 3 Pro Image",
    description: "Higher quality pro-tier image generation",
    maxSize: "1024x1024",
    sizes: ["512x512", "1024x1024"],
    costPerImage: "Free",
  },
  {
    id: "imagen-4.0-generate-001",
    name: "Imagen 4",
    description: "Google's highest-quality image generation model",
    maxSize: "1024x1024",
    sizes: ["1024x1024"],
    qualities: ["standard", "hd"],
    costPerImage: "$0.04",
  },
  {
    id: "imagen-4.0-fast-generate-001",
    name: "Imagen 4 Fast",
    description: "Faster Imagen 4 variant — lower latency",
    maxSize: "1024x1024",
    sizes: ["1024x1024"],
    costPerImage: "$0.02",
  },
  {
    id: "imagen-4.0-ultra-generate-001",
    name: "Imagen 4 Ultra",
    description: "Highest fidelity image generation",
    maxSize: "1024x1024",
    sizes: ["1024x1024"],
    costPerImage: "$0.08",
  },
];

export class GeminiProvider extends AbstractProvider {
  readonly id = "gemini";
  readonly info: ProviderInfo = {
    id: "gemini",
    name: "Google Gemini",
    description: "Gemini 2.0 Flash + Imagen 3 — free tier available",
    website: "https://aistudio.google.com",
    models: MODELS,
    status: "unconfigured",
    requiresApiKey: true,
    freetier: true,
    costPerImage: "Free / $0.04",
    features: ["text-to-image", "image-to-image", "batch", "style-presets"],
  };

  async isConfigured(): Promise<boolean> {
    return !!this.getApiKey("gemini");
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const apiKey = this.getApiKey("gemini");
    if (!apiKey) return { success: false, message: "Gemini API key not configured" };

    try {
      await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { timeout: 10000 }
      );
      return { success: true, message: "Connected to Google Gemini API" };
    } catch (err: any) {
      return {
        success: false,
        message: err.response?.data?.error?.message || err.message,
      };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const apiKey = this.getApiKey("gemini");
    if (!apiKey) return MODELS;

    try {
      const res = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { timeout: 10000 }
      );
      // Only include models whose name contains "image" or "imagen" — those are image-capable
      const imageModels = (res.data?.models || []).filter((m: any) => {
        const name = (m.name || "").toLowerCase();
        return name.includes("image");
      });

      // Merge: keep known MODELS as base, add any new image models from API
      const result: ModelInfo[] = [...MODELS];
      for (const m of imageModels) {
        const id = m.name.replace("models/", "");
        if (!result.find((r) => r.id === id)) {
          result.push({
            id,
            name: m.displayName || id,
            description: m.description || "Gemini image model",
            maxSize: "1024x1024",
            sizes: ["512x512", "1024x1024"],
            costPerImage: "Free (rate-limited)",
          });
        }
      }

      return result;
    } catch {
      return MODELS;
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey("gemini");
    if (!apiKey) {
      return this.errorResult(options, options.model || MODELS[0].id, "Gemini API key not configured", startTime);
    }

    const model = options.model || "gemini-2.5-flash-image";
    const prompt = options.enhancedPrompt || options.prompt;
    const count = options.count || 1;
    const images: GeneratedImage[] = [];

    try {
      if (model.startsWith("gemini")) {
        // Optional reference image — Gemini accepts it as an inline data part
        // alongside the text, enabling image-to-image / editing.
        const ref = this.decodeImageInput(options.referenceImage);
        const parts: any[] = [{ text: prompt }];
        if (ref) parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.base64 } });

        // Gemini multimodal generation
        for (let i = 0; i < count; i++) {
          const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              contents: [{ parts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: {
                  aspectRatio: this.toAspectRatio(options.size),
                },
              },
            },
            {
              headers: { "Content-Type": "application/json" },
              timeout: 120000,
            }
          );

          const candidate = res.data?.candidates?.[0];
          if (!candidate?.content?.parts?.length) {
            const blockReason = candidate?.finishReason || res.data?.candidates?.[0]?.finishReason;
            const filters = res.data?.promptFeedback;
            console.error("[Gemini] No parts in response. finishReason:", blockReason, "promptFeedback:", JSON.stringify(filters));
          }
          const respParts: any[] = candidate?.content?.parts || [];
          for (const part of respParts) {
            if (part.inlineData?.mimeType?.startsWith("image/")) {
              const b64 = part.inlineData.data;
              const savedPath = await this.saveImage(b64, options, images.length, true);
              const size = options.size || "1024x1024";
              const { width, height } = this.parseSize(size);

              images.push({
                id: this.makeImageId(),
                path: savedPath,
                base64: b64,
                width,
                height,
                format: options.format || "png",
                metadata: { model },
              });
            }
          }
        }
      } else if (model.startsWith("imagen")) {
        // Imagen 3
        const res = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`,
          {
            instances: [{ prompt }],
            parameters: {
              sampleCount: count,
              aspectRatio: this.toAspectRatio(options.size),
            },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 120000,
          }
        );

        const predictions = res.data?.predictions || [];
        for (let i = 0; i < predictions.length; i++) {
          const b64 = predictions[i].bytesBase64Encoded;
          const savedPath = await this.saveImage(b64, options, i, true);
          const size = options.size || "1024x1024";
          const { width, height } = this.parseSize(size);

          images.push({
            id: this.makeImageId(),
            path: savedPath,
            base64: b64,
            width,
            height,
            format: options.format || "png",
            metadata: { model },
          });
        }
      }

      if (images.length === 0) {
        return this.errorResult(options, model, "No images returned from Gemini API", startTime);
      }

      return this.buildResult(options, model, images, startTime, prompt);
    } catch (err: any) {
      return this.errorResult(
        options,
        model,
        err.response?.data?.error?.message || err.message,
        startTime
      );
    }
  }

  // Snap any W×H to the closest aspect ratio Imagen accepts.
  private toAspectRatio(size?: string): string {
    if (!size) return "1:1";
    const [w, h] = size.split("x").map(Number);
    if (!w || !h) return "1:1";
    const supported: Array<[string, number]> = [
      ["16:9", 16 / 9], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 3 / 4], ["9:16", 9 / 16],
    ];
    const target = w / h;
    return supported.reduce((best, cur) =>
      Math.abs(cur[1] - target) < Math.abs(best[1] - target) ? cur : best
    )[0];
  }
}
