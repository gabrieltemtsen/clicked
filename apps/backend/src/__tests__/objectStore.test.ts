import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S3ObjectStore } from '../lib/objectStore.js';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mock `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const original = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  
  // Custom mock client to track configuration and calls
  class MockS3Client {
    public config: any;
    public send: any;
    
    constructor(config: any) {
      this.config = config;
      // We will re-assign this fn inside the test or use a global spy
      this.send = vi.fn().mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) {
          return {
            ContentLength: 1024,
            ContentType: 'application/octet-stream',
            Metadata: { encrypted: 'true' },
          };
        }
        return {};
      });
    }
  }

  return {
    ...original,
    S3Client: MockS3Client,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: vi.fn().mockImplementation(async (client, command, options) => {
      const bucket = (command as any).input.Bucket;
      const key = (command as any).input.Key;
      const expires = options?.expiresIn || 300;
      return `https://mock-s3-presigned-url/${bucket}/${key}?expires=${expires}`;
    }),
  };
});

describe('S3ObjectStore Client Wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Configuration & Initialization', () => {
    it('initializes with standard AWS S3 configuration', () => {
      const store = new S3ObjectStore({
        bucket: 'prod-bucket',
        region: 'us-west-2',
      });

      const client = (store as any).client;
      expect(client.config.region).toBe('us-west-2');
      expect(client.config.endpoint).toBeUndefined();
      expect(client.config.credentials).toBeUndefined();
      expect(client.config.forcePathStyle).toBeUndefined();
    });

    it('initializes with MinIO specific configuration (forcePathStyle, custom endpoint)', () => {
      const store = new S3ObjectStore({
        bucket: 'minio-bucket',
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadminsecret',
        forcePathStyle: true,
      });

      const client = (store as any).client;
      expect(client.config.region).toBe('us-east-1');
      expect(client.config.endpoint).toBe('http://127.0.0.1:9000');
      expect(client.config.forcePathStyle).toBe(true);
      expect(client.config.credentials).toEqual({
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadminsecret',
      });
    });

    it('initializes with Cloudflare R2 specific configuration', () => {
      const store = new S3ObjectStore({
        bucket: 'r2-bucket',
        endpoint: 'https://xyz.r2.cloudflarestorage.com',
        region: 'auto',
        accessKeyId: 'r2-key',
        secretAccessKey: 'r2-secret',
      });

      const client = (store as any).client;
      expect(client.config.region).toBe('auto');
      expect(client.config.endpoint).toBe('https://xyz.r2.cloudflarestorage.com');
      expect(client.config.credentials).toEqual({
        accessKeyId: 'r2-key',
        secretAccessKey: 'r2-secret',
      });
    });

    it('throws an error if bucket is not provided', () => {
      expect(() => new S3ObjectStore({ bucket: '' })).toThrow('S3 bucket name is required.');
    });
  });

  describe('Operations', () => {
    let store: S3ObjectStore;

    beforeEach(() => {
      store = new S3ObjectStore({
        bucket: 'test-bucket',
        region: 'us-east-1',
      });
    });

    it('generates a presigned upload URL (PUT)', async () => {
      const url = await store.getUploadUrl('encrypted-file-123.bin', 3600);
      
      expect(url).toContain('https://mock-s3-presigned-url/test-bucket/encrypted-file-123.bin?expires=3600');
      expect(getSignedUrl).toHaveBeenCalledWith(
        (store as any).client,
        expect.any(PutObjectCommand),
        { expiresIn: 3600 }
      );
    });

    it('generates a presigned download URL (GET)', async () => {
      const url = await store.getDownloadUrl('encrypted-file-123.bin', 600);
      
      expect(url).toContain('https://mock-s3-presigned-url/test-bucket/encrypted-file-123.bin?expires=600');
      expect(getSignedUrl).toHaveBeenCalledWith(
        (store as any).client,
        expect.any(GetObjectCommand),
        { expiresIn: 600 }
      );
    });

    it('retrieves metadata via head operation successfully', async () => {
      const metadata = await store.head('encrypted-file-123.bin');
      
      expect(metadata).toEqual({
        contentLength: 1024,
        contentType: 'application/octet-stream',
        metadata: { encrypted: 'true' },
      });
      expect((store as any).client.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('returns null on head operation if object is not found (404 / NotFound)', async () => {
      // Stub send to throw a NotFound error
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      (store as any).client.send.mockRejectedValueOnce(notFoundError);

      const metadata = await store.head('missing-file.bin');
      
      expect(metadata).toBeNull();
      expect((store as any).client.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('returns null on head operation if object is not found (NoSuchKey)', async () => {
      const noSuchKeyError = new Error('NoSuchKey');
      (noSuchKeyError as any).code = 'NoSuchKey';
      (store as any).client.send.mockRejectedValueOnce(noSuchKeyError);

      const metadata = await store.head('missing-file.bin');
      
      expect(metadata).toBeNull();
    });

    it('throws other errors from head operation', async () => {
      const forbiddenError = new Error('Access Denied');
      forbiddenError.name = 'Forbidden';
      (store as any).client.send.mockRejectedValueOnce(forbiddenError);

      await expect(store.head('encrypted-file-123.bin')).rejects.toThrow('Access Denied');
    });

    it('deletes an object successfully', async () => {
      await store.delete('encrypted-file-123.bin');
      
      expect((store as any).client.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });
  });
});
