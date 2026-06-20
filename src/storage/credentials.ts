import crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { StoredCredentials } from "../types/index.js";

const CREDS_DIR = path.join(os.homedir(), ".nenopix");
const CREDS_FILE = path.join(CREDS_DIR, "credentials.enc");
const SALT_FILE = path.join(CREDS_DIR, ".salt");

// Derive a machine-bound encryption key
function getDerivedKey(): Buffer {
  let salt: string;

  if (fs.existsSync(SALT_FILE)) {
    salt = fs.readFileSync(SALT_FILE, "utf-8").trim();
  } else {
    salt = crypto.randomBytes(32).toString("hex");
    fs.ensureDirSync(CREDS_DIR);
    fs.writeFileSync(SALT_FILE, salt, { mode: 0o600 });
  }

  const machineId = `${os.hostname()}-${os.userInfo().username}-nenopix`;
  return crypto.scryptSync(machineId, salt, 32);
}

function encrypt(plaintext: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  });
}

function decrypt(ciphertext: string): string {
  const key = getDerivedKey();
  const { iv, tag, data } = JSON.parse(ciphertext);

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}

export class CredentialStore {
  private credentials: StoredCredentials = {};

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(CREDS_FILE)) {
        const raw = fs.readFileSync(CREDS_FILE, "utf-8");
        const decrypted = decrypt(raw);
        this.credentials = JSON.parse(decrypted);
      }
    } catch {
      this.credentials = {};
    }
  }

  private save(): void {
    fs.ensureDirSync(CREDS_DIR);
    const encrypted = encrypt(JSON.stringify(this.credentials));
    fs.writeFileSync(CREDS_FILE, encrypted, { mode: 0o600 });
  }

  get(providerId: string): StoredCredentials[string] | undefined {
    const key = providerId.toUpperCase().replace(/-/g, "_");
    const envKey = process.env[`NENOPIX_${key}_API_KEY`] || process.env[`IMAGEFORGE_${key}_API_KEY`];
    const envBaseUrl = process.env[`NENOPIX_${key}_BASE_URL`] || process.env[`IMAGEFORGE_${key}_BASE_URL`];
    const stored = this.credentials[providerId];

    if (envKey || envBaseUrl) {
      return {
        ...stored,
        ...(envKey ? { apiKey: envKey } : {}),
        ...(envBaseUrl ? { baseUrl: envBaseUrl } : {}),
      };
    }
    return stored;
  }

  set(
    providerId: string,
    data: StoredCredentials[string]
  ): void {
    this.credentials[providerId] = {
      ...this.credentials[providerId],
      ...data,
    };
    this.save();
  }

  remove(providerId: string): void {
    delete this.credentials[providerId];
    this.save();
  }

  hasKey(providerId: string): boolean {
    const envKey = process.env[`IMAGEFORGE_${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`];
    if (envKey) return true;
    return !!this.credentials[providerId]?.apiKey;
  }

  listConfigured(): string[] {
    const fromEnv = Object.entries(process.env)
      .filter(([k]) => k.startsWith("IMAGEFORGE_") && (k.endsWith("_API_KEY") || k.endsWith("_BASE_URL")))
      .map(([k]) =>
        k
          .replace("IMAGEFORGE_", "")
          .replace("_API_KEY", "")
          .replace("_BASE_URL", "")
          .toLowerCase()
          .replace(/_/g, "-")
      );

    const fromStore = Object.keys(this.credentials).filter(
      (id) => !!this.credentials[id]?.apiKey || !!this.credentials[id]?.baseUrl
    );

    return [...new Set([...fromEnv, ...fromStore])];
  }

  markTested(providerId: string, valid: boolean): void {
    if (this.credentials[providerId]) {
      this.credentials[providerId].testedAt = new Date().toISOString();
      this.credentials[providerId].valid = valid;
      this.save();
    }
  }
}

export const credentialStore = new CredentialStore();
