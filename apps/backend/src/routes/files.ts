import { Router } from 'express';
import type { IRouter } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { messages, conversationMembers } from '../db/schema.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { objectStore } from '../lib/objectStore.js';

export const filesRouter: IRouter = Router();
filesRouter.use(requireAuth);

filesRouter.get('/:fileId', async (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const fileId = req.params['fileId'] as string;

  if (!fileId) {
    res.status(400).json({ error: 'File id is required' });
    return;
  }

  // Find the message that references this file
  const message = await db.query.messages.findFirst({
    where: eq(messages.id, fileId),
  });

  if (!message) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // Check if the user is a member of the conversation where the file was shared
  const membership = await db.query.conversationMembers.findFirst({
    where: and(
      eq(conversationMembers.conversationId, message.conversationId),
      eq(conversationMembers.userId, userId),
    ),
  });

  if (!membership) {
    res.status(403).json({ error: 'Not authorized to access this file' });
    return;
  }

  try {
    // Short-lived URL: 5 minutes
    const presignedUrl = await objectStore.getDownloadUrl(fileId, 300);
    res.json({ url: presignedUrl });
  } catch {
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});
