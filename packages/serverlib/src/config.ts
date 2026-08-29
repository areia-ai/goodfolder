import { S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export interface ServerConfig {
  databaseUrl: string;
  giteaInternalUrl: string;
  giteaAdminUser: string;
  giteaAdminPassword: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
}

export function loadConfig(): ServerConfig {
  return {
    databaseUrl: requiredEnv("DATABASE_URL"),
    giteaInternalUrl:
      process.env.GITEA_INTERNAL_URL ?? "http://goodfolder-gitea:3000",
    giteaAdminUser: process.env.GITEA_ADMIN_USER ?? "gf-service",
    giteaAdminPassword: requiredEnv("GITEA_ADMIN_PASSWORD"),
    s3Endpoint: requiredEnv("S3_ENDPOINT"),
    s3Region: process.env.S3_REGION ?? "auto",
    s3AccessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
    s3Bucket: process.env.S3_BUCKET ?? "goodfolder-dev",
  };
}

export type Sql = postgres.Sql;

export function openDb(url: string): Sql {
  return postgres(url, { max: 5, idle_timeout: 20 });
}

export function makeS3(cfg: ServerConfig): S3Client {
  return new S3Client({
    endpoint: cfg.s3Endpoint,
    region: cfg.s3Region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.s3AccessKeyId,
      secretAccessKey: cfg.s3SecretAccessKey,
    },
  });
}
