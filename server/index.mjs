import { serve } from "@hono/node-server";
import { app } from "./app.mjs";

const port = Number(process.env.PORT) || 8080;

console.log(`Starting mctl-academy Hono server on port ${port}...`);

serve({
  fetch: app.fetch,
  port
});
