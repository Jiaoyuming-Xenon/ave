// Node >=22.19 provides the packaged runtime's SQLite implementation. The server tsconfig
// currently uses @types/node 20, so keep this narrow declaration beside the real import.
// @ts-expect-error node:sqlite was added after the server's current Node declaration package.
import { DatabaseSync as NodeDatabaseSync } from "node:sqlite";
import type { SqliteConstructor } from "./sqlite-types.js";

export const DatabaseSync = NodeDatabaseSync as SqliteConstructor;
