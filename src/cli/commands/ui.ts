import { Command } from "commander";
import { startServer } from "../../server/index.js";

export function makeUICommand(): Command {
  return new Command("ui")
    .description("Launch the ImageForge Web UI (Claude-like interface)")
    .option("-p, --port <number>", "Port to listen on", "7842")
    .option("--no-open", "Don't auto-open browser")
    .action(async (opts: any) => {
      const port = parseInt(opts.port, 10) || 7842;
      await startServer(port, opts.open !== false);
      // Keep process alive
      await new Promise<void>(() => {});
    });
}
