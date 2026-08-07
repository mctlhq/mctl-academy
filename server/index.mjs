import { app } from "./app.mjs";

const port = Number(process.env.PORT) || 8080;
const runtimeName = typeof Bun !== "undefined" ? `Bun ${Bun.version}` : `Node ${process.version}`;

console.log(`Starting mctl-academy Hono server on ${runtimeName} (port ${port})...`);

if (typeof Bun !== "undefined") {
  Bun.serve({
    port,
    fetch: app.fetch,
  });
} else {
  const { serve } = await import("@hono/node-server");
  serve({
    fetch: app.fetch,
    port,
  });
}
