import fs from "fs-extra";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  BaseProvider,
  GenerateOptions,
  GenerateResult,
  GeneratedImage,
  ImageFormat,
} from "../types/index.js";
import { credentialStore } from "../storage/credentials.js";
import { config } from "../storage/config.js";

export abstract class AbstractProvider extends BaseProvider {
  protected getApiKey(providerId: string): string | undefined {
    return credentialStore.get(providerId)?.apiKey;
  }

  protected getBaseUrl(providerId: string): string | undefined {
    return credentialStore.get(providerId)?.baseUrl;
  }

  protected async saveImage(
    data: Buffer | string,
    options: GenerateOptions,
    index: number,
    isBase64 = false
  ): Promise<string> {
    const outputDir = options.outputDir || config.get("outputDir");
    await fs.ensureDir(outputDir);

    const format = (options.format || config.get("defaultFormat")) as ImageFormat;
    const prefix = options.outputPrefix || "imageforge";
    const timestamp = Date.now();
    const filename = `${prefix}_${timestamp}_${index + 1}.${format}`;
    const filepath = path.join(outputDir, filename);

    const buffer = isBase64
      ? Buffer.from(data as string, "base64")
      : (data as Buffer);

    await fs.writeFile(filepath, buffer);
    return filepath;
  }

  protected async downloadImage(url: string): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fetch = require("node-fetch");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download image: ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }

  protected parseSize(size: string): { width: number; height: number } {
    const [w, h] = size.split("x").map(Number);
    return { width: w || 1024, height: h || 1024 };
  }

  /**
   * Decode a reference image supplied as a data URL ("data:image/png;base64,…"),
   * a raw base64 string, or a local file path. Returns null when nothing usable.
   */
  protected decodeImageInput(
    input?: string
  ): { mimeType: string; base64: string; buffer: Buffer } | null {
    if (!input) return null;
    try {
      const dataUrl = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
      if (dataUrl) {
        const buffer = Buffer.from(dataUrl[2], "base64");
        return { mimeType: dataUrl[1], base64: dataUrl[2], buffer };
      }
      if (input.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(input)) {
        const buffer = fs.readFileSync(input);
        const ext = path.extname(input).slice(1).toLowerCase() || "png";
        const mimeType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        return { mimeType, base64: buffer.toString("base64"), buffer };
      }
      // Assume a bare base64 string of a PNG.
      const buffer = Buffer.from(input, "base64");
      return { mimeType: "image/png", base64: input, buffer };
    } catch {
      return null;
    }
  }

  protected buildResult(
    options: GenerateOptions,
    model: string,
    images: GeneratedImage[],
    startTime: number,
    enhancedPrompt?: string,
    cost?: number
  ): GenerateResult {
    return {
      success: true,
      images,
      provider: this.id,
      model,
      prompt: options.prompt,
      enhancedPrompt,
      duration: Date.now() - startTime,
      cost,
    };
  }

  protected errorResult(
    options: GenerateOptions,
    model: string,
    error: string,
    startTime: number
  ): GenerateResult {
    return {
      success: false,
      images: [],
      provider: this.id,
      model,
      prompt: options.prompt,
      duration: Date.now() - startTime,
      error,
    };
  }

  protected makeImageId(): string {
    return uuidv4();
  }
}
