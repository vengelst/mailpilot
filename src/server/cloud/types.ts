export type SupportedCloudProvider = "google_drive" | "onedrive";

export type CloudUploadInput = {
  filename: string;
  mimeType?: string | null;
  content: Buffer;
  targetPath: string;
};

export type CloudUploadResult = {
  provider: SupportedCloudProvider | "mock";
  fileId: string;
  path: string;
};

export interface CloudStorageProvider {
  uploadFile(input: CloudUploadInput): Promise<CloudUploadResult>;
}
