import "dotenv/config";
import { PrismaClient } from "@prisma/client";

/** One process-global client (API, ETL, ingest). Do not `new PrismaClient()` in loops or per chunk. */
export const prisma = new PrismaClient();
