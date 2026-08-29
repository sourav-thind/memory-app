import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const STORJ_ENDPOINT = 'https://gateway.storjshare.io';

const accessKeyId = process.env.EXPO_PUBLIC_STORJ_ACCESS_KEY;
const secretAccessKey = process.env.EXPO_PUBLIC_STORJ_SECRET_KEY;
const bucketName = process.env.EXPO_PUBLIC_STORJ_BUCKET_NAME;

if (!accessKeyId || !secretAccessKey || !bucketName) {
  throw new Error(
    'Missing Storj environment variables. ' +
    'Ensure EXPO_PUBLIC_STORJ_ACCESS_KEY, EXPO_PUBLIC_STORJ_SECRET_KEY, ' +
    'and EXPO_PUBLIC_STORJ_BUCKET_NAME are set in your .env file.'
  );
}

const s3Client = new S3Client({
  endpoint: STORJ_ENDPOINT,
  region: 'us-east-1',
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
  forcePathStyle: true,
});

export async function uploadSnapFile(fileKey, fileBuffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    Body: fileBuffer,
    ContentType: contentType,
  });

  const response = await s3Client.send(command);
  return { key: fileKey, etag: response.ETag };
}

export async function getSnapStreamUrl(fileKey, expiresIn = 3600) {
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn });
  return url;
}

export async function deleteSnapFile(fileKey) {
  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
  });

  await s3Client.send(command);
  return { key: fileKey, deleted: true };
}
