import { handleUpload } from '@vercel/blob/client';
import { getSession, ALLOWED_EXT, MAX_UPLOAD_BYTES } from './auth.js';
import { studentPrefix } from './submissions.js';

// Issues short-lived client tokens so the browser can upload straight to Vercel Blob
// (the old code called put() in the browser with no token, which cannot work).
const CONTENT_TYPES = [
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'application/vnd.oasis.opendocument.text',
  'application/rtf', 'text/rtf', 'application/octet-stream',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const isTokenRequest = req.body?.type === 'blob.generate-client-token';
    // The upload-completed callback comes from Vercel (signature-checked by handleUpload),
    // so only token requests need a logged-in student.
    const session = isTokenRequest ? await getSession(req) : null;
    if (isTokenRequest && session?.user_type !== 'student') {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async pathname => {
        const ext = pathname.includes('.') ? pathname.split('.').pop().toLowerCase() : '';
        if (!pathname.startsWith(studentPrefix(session.user_id)) || pathname.includes('..')) {
          throw new Error('Invalid upload path');
        }
        if (!ALLOWED_EXT.includes(ext)) throw new Error('File type not allowed');
        return {
          allowedContentTypes: CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          tokenPayload: session.user_id,
        };
      },
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(json);
  } catch (e) {
    console.error('upload:', e.message);
    return res.status(400).json({ error: e.message || 'Upload failed' });
  }
}
