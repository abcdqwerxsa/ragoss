/** S3-compatible storage provider (Aliyun OSS / R2 / COS / B2 / MinIO ...). */
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3StorageConfig } from "../core/config.js";
import { resolveSecret } from "../core/config.js";
import { mimeFromKey } from "../core/mime.js";
import type { FetchedObject, ObjectRecord, StorageProvider } from "../core/types.js";

async function toBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  const t = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof t.transformToByteArray === "function") {
    return Buffer.from(await t.transformToByteArray());
  }
  const chunks: Buffer[] = [];
  for await (const c of body as AsyncIterable<Buffer | Uint8Array>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

export function createS3Storage(cfg: S3StorageConfig): StorageProvider {
  const client = new S3Client({
    region: cfg.region ?? "us-east-1",
    ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: cfg.endpoint.includes("r2.cloudflarestorage.com") } : {}),
    credentials: {
      accessKeyId: resolveSecret(cfg.accessKeyId),
      secretAccessKey: resolveSecret(cfg.secretAccessKey),
    },
  });
  const prefix = cfg.prefix ?? "";

  return {
    name: cfg.name,

    async list(): Promise<ObjectRecord[]> {
      const out: ObjectRecord[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? []) {
          if (!o.Key || o.Key.endsWith("/")) continue;
          out.push({
            storage: cfg.name,
            key: o.Key,
            size: o.Size ?? 0,
            mime: mimeFromKey(o.Key),
            mtime: (o.LastModified ?? new Date(0)).toISOString(),
            etag: (o.ETag ?? "").replace(/"/g, ""),
          });
        }
        token = res.NextContinuationToken;
      } while (token);
      return out;
    },

    async get(key: string): Promise<FetchedObject> {
      const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const data = await toBuffer(res.Body);
      return { mime: res.ContentType ?? mimeFromKey(key), data };
    },

    async put(key: string, data: Buffer, mime: string): Promise<void> {
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: data, ContentType: mime }),
      );
    },
  };
}
