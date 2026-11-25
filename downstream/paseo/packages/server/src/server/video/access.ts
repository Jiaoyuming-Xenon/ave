import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EditorPrincipal, EditorRole } from "#video-editor/contracts/v1";
import { editorFailure } from "./errors.js";

interface DeviceRecord {
  deviceId: string;
  tokenHash: string;
  role: EditorRole;
  projectIds: string[] | null;
  revokedAt?: string;
}

interface InvitationRecord {
  invitationId: string;
  tokenHash: string;
  role: EditorRole;
  projectIds: string[];
  expiresAt: string;
  usedAt?: string;
}

interface AccessDocument {
  version: 1;
  devices: DeviceRecord[];
  invitations: InvitationRecord[];
}

export class EditorAccessStore {
  private document: AccessDocument = { version: 1, devices: [], invitations: [] };
  private readonly file: string;
  private writing = Promise.resolve();
  private readonly revokeListeners = new Set<(deviceId: string) => void>();

  constructor(root: string) {
    this.file = path.join(root, "access.json");
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      this.document = parseDocument(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async createInvitation(input: {
    role: Exclude<EditorRole, "owner">;
    projectIds: string[];
    ttlSeconds?: number;
  }): Promise<{ invitationId: string; token: string; expiresAt: string }> {
    if (input.projectIds.length === 0)
      editorFailure("INVALID_ARGUMENT", "An invitation must be scoped to at least one project");
    const token = randomBytes(32).toString("base64url");
    const invitation: InvitationRecord = {
      invitationId: randomUUID(),
      tokenHash: tokenHash(token),
      role: input.role,
      projectIds: input.projectIds,
      expiresAt: new Date(Date.now() + (input.ttlSeconds ?? 600) * 1000).toISOString(),
    };
    this.document.invitations.push(invitation);
    await this.persist();
    return { invitationId: invitation.invitationId, token, expiresAt: invitation.expiresAt };
  }

  async redeemInvitation(
    invitationId: string,
    token: string,
  ): Promise<{ deviceId: string; credential: string; principal: EditorPrincipal }> {
    const invitation = this.document.invitations.find(
      (candidate) => candidate.invitationId === invitationId,
    );
    if (
      !invitation ||
      invitation.usedAt ||
      Date.parse(invitation.expiresAt) <= Date.now() ||
      !sameSecret(invitation.tokenHash, token)
    ) {
      editorFailure(
        "UNAUTHENTICATED",
        "The pairing invitation is invalid, expired or already used",
      );
    }
    const credential = randomBytes(32).toString("base64url");
    const device: DeviceRecord = {
      deviceId: randomUUID(),
      tokenHash: tokenHash(credential),
      role: invitation.role,
      projectIds: invitation.projectIds,
    };
    invitation.usedAt = new Date().toISOString();
    this.document.devices.push(device);
    await this.persist();
    return {
      deviceId: device.deviceId,
      credential,
      principal: { principalId: device.deviceId, role: device.role, projectIds: device.projectIds },
    };
  }

  authenticate(deviceId: string, credential: string): EditorPrincipal {
    const device = this.document.devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device || device.revokedAt || !sameSecret(device.tokenHash, credential)) {
      editorFailure("UNAUTHENTICATED", "The device credential is invalid or revoked");
    }
    return this.activePrincipal(deviceId);
  }

  activePrincipal(deviceId: string): EditorPrincipal {
    const device = this.document.devices.find((record) => record.deviceId === deviceId);
    if (!device || device.revokedAt || device.role === "owner" || !device.projectIds?.length)
      editorFailure("UNAUTHENTICATED", "The device is not active");
    return { principalId: deviceId, role: device.role, projectIds: device.projectIds };
  }

  async revoke(deviceId: string): Promise<void> {
    const device = this.document.devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) editorFailure("PROJECT_NOT_FOUND", "The device does not exist");
    device.revokedAt = new Date().toISOString();
    await this.persist();
    for (const listener of this.revokeListeners) listener(deviceId);
  }

  /** Live channels (e.g. the isolated video reader socket) terminate as soon as a device is revoked. */
  onRevoke(listener: (deviceId: string) => void): () => void {
    this.revokeListeners.add(listener);
    return () => {
      this.revokeListeners.delete(listener);
    };
  }

  private async persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, { mode: 0o600 });
      return rename(temporary, this.file);
    });
    await this.writing;
  }
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(expectedHex: string, token: string): boolean {
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(tokenHash(token), "hex");
  return timingSafeEqual(expected, actual);
}

function parseDocument(value: unknown): AccessDocument {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid video device access store");
  const candidate = value as { version?: unknown; devices?: unknown; invitations?: unknown };
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.devices) ||
    !Array.isArray(candidate.invitations)
  ) {
    throw new Error("Unsupported video device access store");
  }
  return candidate as AccessDocument;
}
