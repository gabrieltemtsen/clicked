import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Configuration options for the S3-compatible ObjectStore.
 */
export interface ObjectStoreConfig {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * Provider-agnostic interface for storage clients.
 * This guarantees interchangeability between MinIO, R2, and S3.
 *
 * NOTE: All bytes that touch this layer MUST be already-encrypted ciphertext.
 * This layer MUST NEVER accept, store, or process plaintext data.
 */
export interface ObjectStore {
  /**
   * Generates a presigned upload (PUT) URL.
   * Allows clients to upload encrypted ciphertext directly.
   */
  getUploadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Generates a presigned download (GET) URL.
   * Allows clients to download encrypted ciphertext directly.
   */
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Retrieves metadata and checks existence of an encrypted object.
   * Returns null if the object is not found.
   */
  head(key: string): Promise<{ contentLength?: number; contentType?: string; metadata?: Record<string, string> } | null>;

  /**
   * Deletes an encrypted object from the store.
   */
  delete(key: string): Promise<void>;
}

/**
 * S3-compatible implementation of ObjectStore.
 */
export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor(config: ObjectStoreConfig) {
    if (!config.bucket) {
      throw new Error('S3 bucket name is required.');
    }
    this.bucket = config.bucket;

    const s3Config: any = {
      region: config.region || 'us-east-1',
    };

    if (config.endpoint) {
      s3Config.endpoint = config.endpoint;
    }

    if (config.forcePathStyle !== undefined) {
      s3Config.forcePathStyle = config.forcePathStyle;
    }

    if (config.accessKeyId && config.secretAccessKey) {
      s3Config.credentials = {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      };
    }

    this.client = new S3Client(s3Config);
  }

  async getUploadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async getDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async head(key: string): Promise<{ contentLength?: number; contentType?: string; metadata?: Record<string, string> } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      return {
        contentLength: response.ContentLength,
        contentType: response.ContentType,
        metadata: response.Metadata,
      };
    } catch (error: any) {
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404 ||
        error.code === 'NoSuchKey'
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }
}

// Instantiate the singleton using environment variables with fallback support
const bucket = process.env['S3_BUCKET'] || process.env['AWS_BUCKET'] || 'clicked-files';
const endpoint = process.env['S3_ENDPOINT'];
const region = process.env['S3_REGION'] || process.env['AWS_REGION'] || 'us-east-1';
const accessKeyId = process.env['S3_ACCESS_KEY_ID'] || process.env['AWS_ACCESS_KEY_ID'];
const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'] || process.env['AWS_SECRET_ACCESS_KEY'];
const forcePathStyle = process.env['S3_FORCE_PATH_STYLE'] === 'true' || process.env['AWS_FORCE_PATH_STYLE'] === 'true';

export const objectStore = new S3ObjectStore({
  bucket,
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
});
