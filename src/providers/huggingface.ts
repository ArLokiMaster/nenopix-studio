import axios from "axios";
import {
  ProviderInfo,
  ModelInfo,
  GenerateOptions,
  GenerateResult,
  GeneratedImage,
} from "../types/index.js";
import { AbstractProvider } from "./base.js";

const HF_API = "https://router.huggingface.co/hf-inference/models";

const MODELS: ModelInfo[] = [
  {
    id: "black-forest-labs/FLUX.1-schnell",
    name: "FLUX.1 Schnell (HF)",
    description: "Fastest FLUX model via HuggingFace Inference API",
    maxSize: "1024x1024",
    sizes: ["512x512", "768x768", "1024x1024"],
    costPerImage: "Free (rate-limited)",
    recommended: true,
  },
  {
    id: "stabilityai/stable-diffusion-xl-base-1.0",
    name: "SDXL Base 1.0",
    description: "Open-source SDXL via HuggingFace",
    maxSize: "1024x1024",
    sizes: ["768x768", "1024x1024"],
    costPerImage: "Free (rate-limited)",
  },
  {
    id: "runwayml/stable-diffusion-v1-5",
    name: "Stable Diffusion 1.5",
    description: "Classic SD model, lightweight and fast",
    maxSize: "512x512",
    sizes: ["256x256", "512x512"],
    costPerImage: "Free",
  },
  {
    id: "prompthero/openjourney-v4",
    name: "OpenJourney V4",
    description: "Midjourney-style outputs",
    maxSize: "512x512",
    sizes: ["512x512"],
    costPerImage: "Free",
  },
];

export class HuggingFaceProvider extends AbstractProvider {
  readonly id = "huggingface";
  readonly info: ProviderInfo = {
    id: "huggingface",
    name: "HuggingFace",
    description: "FLUX, SDXL, SD — open-source models with free tier",
    website: "https://huggingface.co",
    models: MODELS,
    status: "unconfigured",
    requiresApiKey: true,
    freetier: true,
    costPerImage: "Free (rate-limited)",
    features: [
      "text-to-image",
      "image-to-image",
      "negative-prompts",
      "seeds",
    ],
  };

  async isConfigured(): Promise<boolean> {
    return !!this.getApiKey("huggingface");
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    const apiKey = this.getApiKey("huggingface");
    if (!apiKey) return { success: false, message: "HuggingFace API key not configured" };

    try {
      await axios.get("https://huggingface.co/api/whoami-v2", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "imageforge-cli/1.0.0",
        },
        timeout: 10000,
      });
      return { success: true, message: "Connected to HuggingFace API" };
    } catch (err: any) {
      if (err.response?.status === 401) {
        return { success: false, message: "Invalid HuggingFace API key" };
      }
      return { success: false, message: err.message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return MODELS;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();
    const apiKey = this.getApiKey("huggingface");
    if (!apiKey) {
      return this.errorResult(options, options.model || MODELS[0].id, "HuggingFace API key not configured", startTime);
    }

    const model = options.model || "black-forest-labs/FLUX.1-schnell";
    const prompt = options.enhancedPrompt || options.prompt;
    const count = options.count || 1;
    const images: GeneratedImage[] = [];

    try {
      for (let i = 0; i < count; i++) {
        const payload: Record<string, unknown> = {
          inputs: prompt,
          parameters: {},
        };

        const params = payload.parameters as Record<string, unknown>;
        if (options.negativePrompt) params.negative_prompt = options.negativePrompt;
        if (options.seed) params.seed = options.seed + i;
        if (options.steps) params.num_inference_steps = options.steps;
        if (options.cfgScale) params.guidance_scale = options.cfgScale;

        // Retry logic for model loading
        let buffer: Buffer | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await axios.post(`${HF_API}/${model}`, payload, {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                Accept: "image/png",
                "User-Agent": "imageforge-cli/1.0.0",
              },
              responseType: "arraybuffer",
              timeout: 120000,
            });

            buffer = Buffer.from(res.data);
            break;
          } catch (err: any) {
            if (err.response?.status === 503 && attempt < 2) {
              // Model loading
              await new Promise((r) => setTimeout(r, 20000));
              continue;
            }
            throw err;
          }
        }

        if (!buffer) throw new Error("Failed to generate after retries");

        const savedPath = await this.saveImage(buffer, options, i);
        const { width, height } = this.parseSize(options.size || "512x512");

        images.push({
          id: this.makeImageId(),
          path: savedPath,
          width,
          height,
          format: options.format || "png",
          seed: options.seed ? options.seed + i : undefined,
          metadata: { model },
        });
      }

      return this.buildResult(options, model, images, startTime, prompt);
    } catch (err: any) {
      let msg = err.message;
      if (err.response?.data instanceof Buffer) {
        try {
          msg = JSON.parse(err.response.data.toString())?.error || err.message;
        } catch {
          msg = err.response.data.toString() || err.message;
        }
      } else {
        msg = err.response?.data?.error || err.message;
      }

      return this.errorResult(options, model, msg, startTime);
    }
  }
}
