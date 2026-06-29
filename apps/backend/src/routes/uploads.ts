import { Router } from 'express';
import type { IRouter } from 'express';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db/index.js';
import { files } from '../db/schema.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const uploadsRouter: IRouter = Router();
uploadsRouter.use(requireAuth);

const s3 = new S3Client({
  region: process.env['AWS_REGION'] || 'us-east-1',
});
const bucketName = process.env['AWS_BUCKET'] || 'clicked-files';

uploadsRouter.post('/', async (_req: AuthRequest, res) => {
  const fileId = randomUUID();
  try {
    await db.insert(files).values({
      id: fileId,
      storageKey: fileId,
      status: 'pending',
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileId,
    });
    // Short-lived URL: 15 minutes
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    res.status(201).json({ fileId, uploadUrl: presignedUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initiate upload' });
  }
});

uploadsRouter.post('/:fileId/confirm', async (req: AuthRequest, res) => {
  const fileId = req.params['fileId'] as string;
  const { size, sha256 } = req.body as { size?: number; sha256?: string };

  if (!fileId) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }
  if (size === undefined || typeof size !== 'number') {
    res.status(400).json({ error: 'Size is required and must be a number' });
    return;
  }

  const file = await db.query.files.findFirst({
    where: eq(files.id, fileId),
  });

  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  if (file.status === 'ready') {
    res.status(200).json({ message: 'File is already ready' });
    return;
  }

  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucketName,
      Key: file.storageKey,
    });
    const headOutput = await s3.send(headCommand);

    if (headOutput.ContentLength !== size) {
      res.status(400).json({ error: 'Size mismatch' });
      return;
    }

    if (sha256) {
      if (headOutput.ChecksumSHA256 && headOutput.ChecksumSHA256 !== sha256) {
        res.status(400).json({ error: 'Hash mismatch' });
        return;
      }
      if (
        headOutput.Metadata &&
        headOutput.Metadata['sha256'] &&
        headOutput.Metadata['sha256'] !== sha256
      ) {
        res.status(400).json({ error: 'Hash mismatch' });
        return;
      }
    }

    await db
      .update(files)
      .set({ status: 'ready', size, sha256: sha256 || null })
      .where(eq(files.id, fileId));

    res.status(200).json({ message: 'File confirmed' });
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      res.status(400).json({ error: 'File not found in storage. Ensure upload completed.' });
      return;
    }
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
});
