import { decryptSecret } from "@/server/security/crypto";
import {
  CloudStorageProvider,
  CloudUploadInput,
  CloudUploadResult,
  SupportedCloudProvider,
} from "@/server/cloud/types";

type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
};

export class MockCloudProvider implements CloudStorageProvider {
  async uploadFile(input: CloudUploadInput): Promise<CloudUploadResult> {
    return {
      provider: "mock",
      fileId: `mock_${Date.now()}`,
      path: `${input.targetPath}${input.filename}`,
    };
  }
}

abstract class OAuthCloudProviderBase implements CloudStorageProvider {
  constructor(private readonly provider: SupportedCloudProvider, private readonly tokens: TokenSet) {}

  protected getAccessToken() {
    return this.tokens.accessToken;
  }

  protected getProvider() {
    return this.provider;
  }

  abstract uploadFile(input: CloudUploadInput): Promise<CloudUploadResult>;
}

export class GoogleDriveProvider extends OAuthCloudProviderBase {
  async uploadFile(input: CloudUploadInput): Promise<CloudUploadResult> {
    // Phase 5 foundation: request shape prepared, real multipart upload can be refined.
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=media", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.getAccessToken()}`,
        "content-type": input.mimeType ?? "application/octet-stream",
      },
      body: new Uint8Array(input.content),
    });

    if (!response.ok) {
      throw new Error(`Google Drive upload failed with status ${response.status}`);
    }

    const data = (await response.json()) as { id?: string };
    return {
      provider: this.getProvider(),
      fileId: data.id ?? `google_${Date.now()}`,
      path: `${input.targetPath}${input.filename}`,
    };
  }
}

export class OneDriveProvider extends OAuthCloudProviderBase {
  async uploadFile(input: CloudUploadInput): Promise<CloudUploadResult> {
    const remotePath = `${input.targetPath}${input.filename}`.replace(/^\/+/, "");
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(remotePath)}:/content`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${this.getAccessToken()}`,
          "content-type": input.mimeType ?? "application/octet-stream",
        },
        body: new Uint8Array(input.content),
      },
    );

    if (!response.ok) {
      throw new Error(`OneDrive upload failed with status ${response.status}`);
    }

    const data = (await response.json()) as { id?: string };
    return {
      provider: this.getProvider(),
      fileId: data.id ?? `onedrive_${Date.now()}`,
      path: `${input.targetPath}${input.filename}`,
    };
  }
}

export function createCloudProvider(input: {
  provider: SupportedCloudProvider | "mock";
  encryptedAccessToken?: string | null;
  encryptedRefreshToken?: string | null;
}): CloudStorageProvider {
  if (input.provider === "mock") {
    return new MockCloudProvider();
  }

  if (!input.encryptedAccessToken) {
    throw new Error("No encrypted access token configured for selected provider");
  }

  const tokens: TokenSet = {
    accessToken: decryptSecret(input.encryptedAccessToken),
    refreshToken: input.encryptedRefreshToken ? decryptSecret(input.encryptedRefreshToken) : null,
  };

  if (input.provider === "google_drive") {
    return new GoogleDriveProvider("google_drive", tokens);
  }
  return new OneDriveProvider("onedrive", tokens);
}
