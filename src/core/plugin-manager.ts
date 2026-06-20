import fs from "fs-extra";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { ImageForgePlugin } from "../types/index.js";
import { registry } from "./provider-registry.js";
import { config } from "../storage/config.js";

const PLUGINS_DIR = path.join(os.homedir(), ".imageforge", "plugins");

class PluginManager {
  private loadedPlugins: Map<string, ImageForgePlugin> = new Map();

  async loadAll(): Promise<void> {
    await fs.ensureDir(PLUGINS_DIR);
    const installed = config.get("installedPlugins");

    for (const pluginName of installed) {
      await this.load(pluginName);
    }
  }

  async load(pluginName: string): Promise<void> {
    try {
      const pluginPath = path.join(PLUGINS_DIR, "node_modules", pluginName);
      if (!fs.existsSync(pluginPath)) return;

      const mod = require(pluginPath);
      const plugin: ImageForgePlugin = mod.default || mod;

      if (!plugin?.name || !plugin?.version) {
        console.warn(`Plugin ${pluginName} missing name/version, skipping`);
        return;
      }

      // Register providers from plugin
      if (plugin.providers) {
        for (const { factory } of plugin.providers) {
          registry.register(factory());
        }
      }

      this.loadedPlugins.set(pluginName, plugin);
    } catch (err: any) {
      console.warn(`Failed to load plugin ${pluginName}: ${err.message}`);
    }
  }

  async install(pluginName: string): Promise<{ success: boolean; message: string }> {
    try {
      await fs.ensureDir(PLUGINS_DIR);

      console.log(`Installing ${pluginName}...`);
      execSync(`npm install ${pluginName}`, {
        cwd: PLUGINS_DIR,
        stdio: "inherit",
      });

      const installed = config.get("installedPlugins");
      if (!installed.includes(pluginName)) {
        config.set("installedPlugins", [...installed, pluginName]);
      }

      await this.load(pluginName);
      return { success: true, message: `Plugin ${pluginName} installed successfully` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async uninstall(pluginName: string): Promise<{ success: boolean; message: string }> {
    try {
      execSync(`npm uninstall ${pluginName}`, {
        cwd: PLUGINS_DIR,
        stdio: "inherit",
      });

      const installed = config.get("installedPlugins");
      config.set(
        "installedPlugins",
        installed.filter((p) => p !== pluginName)
      );

      this.loadedPlugins.delete(pluginName);
      return { success: true, message: `Plugin ${pluginName} uninstalled` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  listLoaded(): ImageForgePlugin[] {
    return Array.from(this.loadedPlugins.values());
  }

  getPlugin(name: string): ImageForgePlugin | undefined {
    return this.loadedPlugins.get(name);
  }

  async runHook<T>(
    hookName: keyof NonNullable<ImageForgePlugin["hooks"]>,
    data: T
  ): Promise<T> {
    let result = data;
    for (const plugin of this.loadedPlugins.values()) {
      const hook = plugin.hooks?.[hookName] as ((d: T) => Promise<T>) | undefined;
      if (hook) {
        try {
          result = await hook(result);
        } catch (err: any) {
          console.warn(`Plugin ${plugin.name} hook ${hookName} failed: ${err.message}`);
        }
      }
    }
    return result;
  }
}

export const pluginManager = new PluginManager();
