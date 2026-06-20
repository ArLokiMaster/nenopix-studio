import fs from "fs-extra";
import path from "path";
import os from "os";
import { AppConfig } from "../types/index.js";

const CONFIG_DIR = path.join(os.homedir(), ".nenopix");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  defaultProvider: "gemini",
  defaultModel: "gemini-2.5-flash-image",
  defaultSize: "1024x1024",
  defaultQuality: "standard",
  defaultFormat: "png",
  outputDir: path.join(os.homedir(), "nenopix-output"),
  enhancePrompts: true,
  enhanceProvider: "rule-based",
  jsonOutput: false,
  verbose: false,
  noBanner: false,
  setupComplete: false,
  installedPlugins: [],
  version: "1.0.0",
};

class ConfigManager {
  private data: AppConfig;

  constructor() {
    this.data = this.load();
  }

  private load(): AppConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // corrupt file — reset
    }
    return { ...DEFAULT_CONFIG };
  }

  private save(): void {
    fs.ensureDirSync(CONFIG_DIR);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    const envMap: Partial<Record<keyof AppConfig, string>> = {
      defaultProvider: "IMAGEFORGE_DEFAULT_PROVIDER",
      defaultModel: "IMAGEFORGE_DEFAULT_MODEL",
      defaultSize: "IMAGEFORGE_DEFAULT_SIZE",
      defaultQuality: "IMAGEFORGE_DEFAULT_QUALITY",
      outputDir: "IMAGEFORGE_OUTPUT_DIR",
      enhancePrompts: "IMAGEFORGE_ENHANCE_PROMPTS",
      jsonOutput: "IMAGEFORGE_JSON_OUTPUT",
      verbose: "IMAGEFORGE_VERBOSE",
      noBanner: "IMAGEFORGE_NO_BANNER",
    };

    const envKey = envMap[key];
    const nenopixEnvKey = envKey ? envKey.replace("IMAGEFORGE_", "NENOPIX_") : undefined;
    const actualEnvVal = (nenopixEnvKey && process.env[nenopixEnvKey] !== undefined)
      ? process.env[nenopixEnvKey]
      : (envKey ? process.env[envKey] : undefined);

    if (actualEnvVal !== undefined) {
      const val = actualEnvVal;
      if (typeof DEFAULT_CONFIG[key] === "boolean") {
        return (val === "true") as AppConfig[K];
      }
      return val as AppConfig[K];
    }

    return this.data[key] ?? DEFAULT_CONFIG[key];
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.data[key] = value;
    this.save();
  }

  getAll(): AppConfig {
    return { ...this.data };
  }

  reset(): void {
    this.data = { ...DEFAULT_CONFIG };
    this.save();
  }

  get configPath(): string {
    return CONFIG_FILE;
  }

  get isSetupComplete(): boolean {
    return this.get("setupComplete");
  }

  markSetupComplete(): void {
    this.set("setupComplete", true);
  }
}

export const config = new ConfigManager();
