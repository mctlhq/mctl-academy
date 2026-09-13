/**
 * The relay is protocol translation: Anthropic Messages in, OpenAI
 * chat-completions out, and the answer back again. Every property here was a
 * real defect first -- a whole run died on each of the first two -- so the test
 * drives the actual process against a stub upstream rather than asserting on
 * the source.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RELAY = fileURLToPath(new URL("../scripts/nebius-relay.py", import.meta.url));
const havePython = spawnSync("python3", ["--version"]).status === 0;
// Skipping is a local convenience. In CI it would answer the "415 lines with no
// test" finding by not running, which is the one outcome that must not be green.
if (!havePython && process.env.CI) {
  throw new Error("python3 is required to test the relay, and this is CI");
}

let upstream; // the stub
let relay; // the process under test
let relayUrl;
let seen; // the last body the upstream received
let reply; // what the stub answers with next

function sse(lines) {
  return lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join("") + "data: [DONE]\n\n";
}

before(async () => {
  if (!havePython) return;
  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = JSON.parse(body);
      const { status = 200, stream = false, payload } = reply;
      res.writeHead(status, {
        "content-type": stream ? "text/event-stream" : "application/json",
      });
      res.end(stream ? sse(payload) : JSON.stringify(payload));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const addr = upstream.address();
  const upstreamUrl = `http://127.0.0.1:${typeof addr === "string" ? addr : addr.port}/v1`;

  const port = 8788 + (process.pid % 200);
  relayUrl = `http://127.0.0.1:${port}`;
  relay = spawn("python3", [RELAY], {
    env: {
      ...process.env,
      NEBIUS_API_KEY: "test-key",
      NEBIUS_BASE_URL: upstreamUrl,
      NEBIUS_MODEL: "stub/Default-Model",
      RELAY_PORT: String(port),
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${relayUrl}/health`);
      if (r.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the relay never came up");
});

after(() => {
  relay?.kill();
  upstream?.close();
});

const ask = (body) =>
  fetch(`${relayUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("every system fragment is folded into one leading message", { skip: !havePython }, async () => {
  reply = { payload: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } };
  // Claude Code sends a system prompt AND system-role entries inside messages.
  // The upstream answers "System message must be at the beginning." to the
  // second one and the whole run fails.
  await ask({
    model: "claude-sonnet-5",
    system: "first",
    messages: [
      { role: "user", content: "hello" },
      { role: "system", content: "second" },
      { role: "assistant", content: "hi" },
    ],
  });
  const roles = seen.messages.map((m) => m.role);
  assert.deepEqual(roles, ["system", "user", "assistant"]);
  assert.equal(seen.messages[0].content, "first\n\nsecond");
});

test("a claude model name is replaced, any other is passed through", { skip: !havePython }, async () => {
  reply = { payload: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } };
  await ask({ model: "claude-opus-5", messages: [{ role: "user", content: "x" }] });
  assert.equal(seen.model, "stub/Default-Model");
  await ask({ model: "vendor/Some-Model", messages: [{ role: "user", content: "x" }] });
  assert.equal(seen.model, "vendor/Some-Model");
});

test("a failed tool result is not replayed as a successful one", { skip: !havePython }, async () => {
  reply = { payload: { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] } };
  await ask({
    model: "claude-sonnet-5",
    messages: [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "permission denied", is_error: true },
          { type: "tool_result", tool_use_id: "t2", content: "file contents" },
        ],
      },
    ],
  });
  const tools = seen.messages.filter((m) => m.role === "tool");
  assert.match(tools[0].content, /^Error: permission denied/);
  assert.equal(tools[1].content, "file contents");
});

test(
  "tool calls end the turn as tool_use even when the upstream says stop",
  { skip: !havePython },
  async () => {
    const call = { id: "c1", type: "function", function: { name: "Read", arguments: '{"p":1}' } };
    reply = {
      payload: { choices: [{ message: { content: "", tool_calls: [call] }, finish_reason: "stop" }] },
    };
    const body = await (
      await ask({ model: "claude-sonnet-5", messages: [{ role: "user", content: "x" }] })
    ).json();
    // end_turn here tells the client to stop instead of running the tool.
    assert.equal(body.stop_reason, "tool_use");
    assert.equal(body.content[0].type, "tool_use");
    assert.deepEqual(body.content[0].input, { p: 1 });
  },
);

test(
  "a tool call cut at max_tokens is reported as truncation, not as a tool call",
  { skip: !havePython },
  async () => {
    const call = {
      id: "c1",
      type: "function",
      function: { name: "Write", arguments: '{"content":"id: q-' },
    };
    reply = {
      payload: { choices: [{ message: { content: "", tool_calls: [call] }, finish_reason: "length" }] },
    };
    const body = await (
      await ask({ model: "claude-sonnet-5", messages: [{ role: "user", content: "x" }] })
    ).json();
    // The author writes whole YAML files through Write, so a generation cut at
    // the ceiling is cut INSIDE function.arguments. Calling that tool_use hands
    // the client truncated JSON with nothing naming truncation as the cause.
    assert.equal(body.stop_reason, "max_tokens");

    reply = {
      stream: true,
      payload: [
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "c1", function: { name: "Write", arguments: '{"a' } }],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ],
    };
    const text = await (
      await ask({ model: "claude-sonnet-5", stream: true, messages: [{ role: "user", content: "x" }] })
    ).text();
    const delta = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)))
      .find((e) => e.type === "message_delta");
    assert.equal(delta.delta.stop_reason, "max_tokens");
  },
);

test(
  "a streamed turn reports both token counts and the tool stop reason",
  { skip: !havePython },
  async () => {
    reply = {
      stream: true,
      payload: [
        { choices: [{ delta: { content: "thinking out loud" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, id: "c1", function: { name: "Write", arguments: '{"a":' } }],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] },
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 4321, completion_tokens: 12 },
        },
      ],
    };
    const res = await ask({
      model: "claude-sonnet-5",
      stream: true,
      messages: [{ role: "user", content: "x" }],
    });
    const text = await res.text();
    const events = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));

    const delta = events.find((e) => e.type === "message_delta");
    assert.equal(delta.delta.stop_reason, "tool_use");
    // A hardcoded zero every turn hides the context filling up from the client.
    assert.equal(delta.usage.input_tokens, 4321);
    assert.equal(delta.usage.output_tokens, 12);

    const started = events.filter((e) => e.type === "content_block_start");
    assert.deepEqual(
      started.map((e) => e.content_block.type),
      ["text", "tool_use"],
    );
    const json = events
      .filter((e) => e.type === "content_block_delta" && e.delta.type === "input_json_delta")
      .map((e) => e.delta.partial_json)
      .join("");
    assert.deepEqual(JSON.parse(json), { a: 1 });
  },
);

test("an upstream failure answers in the shape the client parses", { skip: !havePython }, async () => {
  reply = { status: 429, payload: { error: { message: "slow down" } } };
  const res = await ask({ model: "claude-sonnet-5", messages: [{ role: "user", content: "x" }] });
  const body = await res.json();
  assert.equal(res.status, 429);
  assert.equal(body.type, "error");
  assert.match(body.error.message, /slow down/);
});

test("count_tokens answers, because a 404 there ends the session", { skip: !havePython }, async () => {
  const res = await fetch(`${relayUrl}/v1/messages/count_tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(400) }] }),
  });
  assert.equal(res.status, 200);
  assert.ok((await res.json()).input_tokens > 0);
});
