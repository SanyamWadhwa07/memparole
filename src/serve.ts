// Runs the MCP server over stdio:
//   node --experimental-strip-types src/serve.ts --db memory.db [--trust-owner-claims]
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "node:util";
import { Store } from "./core/store.ts";
import { createServer } from "./mcp.ts";

const { values } = parseArgs({ options: { db: { type: "string", default: "memparole.db" }, "trust-owner-claims": { type: "boolean", default: false } } });
const server = createServer(new Store(values.db), { trustOwnerClaims: values["trust-owner-claims"] });
await server.connect(new StdioServerTransport());
console.error(`memparole MCP server on stdio, database ${values.db}`);
