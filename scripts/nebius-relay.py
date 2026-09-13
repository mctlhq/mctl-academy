#!/usr/bin/env python3
"""Anthropic Messages API -> Nebius Token Factory (OpenAI chat-completions).

Claude Code speaks only the Anthropic protocol; Token Factory speaks only the
OpenAI one. This translates between them so ANTHROPIC_BASE_URL can point here.

Env:
  NEBIUS_API_KEY   required
  NEBIUS_BASE_URL  default https://api.tokenfactory.nebius.com/v1
  NEBIUS_MODEL     default zai-org/GLM-5.3
  RELAY_PORT       default 8787
"""

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_KEY = os.environ.get("NEBIUS_API_KEY", "")
BASE_URL = os.environ.get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1").rstrip("/")
# GLM-5.3 over the cookbook's Kimi-K2.7-Code: both cite verbatim and both refuse
# to invent a question when no source covers the objective, but GLM answers in a
# third of the time. The comparison is recorded in the pull request that added
# this file; nothing in the repository reproduces it.
MODEL = os.environ.get("NEBIUS_MODEL", "zai-org/GLM-5.3")
PORT = int(os.environ.get("RELAY_PORT", "8787"))

# python.org builds on macOS ship no root store, so urllib fails
# CERTIFICATE_VERIFY_FAILED against every https host. Prefer certifi, fall back
# to the system bundle that ships with macOS.
def _ssl_context():
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    for cafile in ("/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/cert.pem",
                   "/usr/local/etc/openssl/cert.pem"):
        if os.path.exists(cafile):
            return ssl.create_default_context(cafile=cafile)
    return ssl.create_default_context()

SSL_CTX = _ssl_context()

STOP_REASON = {
    "stop": "end_turn",
    "length": "max_tokens",
    "tool_calls": "tool_use",
    "function_call": "tool_use",
    "content_filter": "end_turn",
}


def stop_reason_for(finish, had_tool_calls):
    """Anthropic stop_reason from an OpenAI finish_reason.

    Some endpoints answer "stop" on a turn that also emitted tool_calls, and
    end_turn tells the client to stop instead of running them. But the override
    is a fallback, not a replacement: "length" means the generation was cut --
    inside function.arguments, on the agent that writes whole YAML files -- and
    reporting that as a complete tool call hands the client truncated JSON with
    nothing naming truncation as the cause. Same for content_filter.
    """
    stop = STOP_REASON.get(finish, "end_turn")
    if had_tool_calls and stop == "end_turn":
        return "tool_use"
    return stop


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def text_of(content):
    """Flatten an Anthropic content value to plain text."""
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, str):
            out.append(b)
        elif b.get("type") == "text":
            out.append(b.get("text", ""))
    return "".join(out)


def to_openai(req):
    """Anthropic request body -> OpenAI chat-completions body."""
    messages = []
    # Every system fragment is folded into ONE leading message. Claude Code
    # also sends system-role entries inside `messages`, and the upstream
    # rejects those outright: "System message must be at the beginning."
    system_parts = []
    if req.get("system"):
        system_parts.append(text_of(req["system"]))

    for m in req.get("messages", []):
        role = m.get("role")
        content = m.get("content")

        if role == "system":
            system_parts.append(text_of(content))
            continue

        if isinstance(content, str):
            messages.append({"role": role, "content": content})
            continue

        if role == "user":
            # tool_result blocks become their own OpenAI `tool` messages and
            # must precede whatever plain text came with them.
            texts, tools_out = [], []
            for b in content or []:
                t = b.get("type")
                if t == "text":
                    texts.append(b.get("text", ""))
                elif t == "tool_result":
                    # OpenAI has no is_error field, and a denied Write replayed
                    # as an ordinary result makes the model reason from a
                    # success that never happened.
                    body = text_of(b.get("content")) or ""
                    if b.get("is_error"):
                        body = f"Error: {body}" if body else "Error: the tool call failed."
                    tools_out.append({
                        "role": "tool",
                        "tool_call_id": b.get("tool_use_id", ""),
                        "content": body,
                    })
                elif t == "image":
                    texts.append("[image omitted: upstream model is text-only]")
                else:
                    log(f"[relay] unhandled user block: {t}")
            messages.extend(tools_out)
            if any(s.strip() for s in texts):
                messages.append({"role": "user", "content": "".join(texts)})
            continue

        # assistant
        texts, calls = [], []
        for b in content or []:
            t = b.get("type")
            if t == "text":
                texts.append(b.get("text", ""))
            elif t == "tool_use":
                calls.append({
                    "id": b.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": b.get("name", ""),
                        "arguments": json.dumps(b.get("input", {})),
                    },
                })
            elif t in ("thinking", "redacted_thinking"):
                pass
            else:
                log(f"[relay] unhandled assistant block: {t}")
        msg = {"role": "assistant", "content": "".join(texts)}
        if calls:
            msg["tool_calls"] = calls
        messages.append(msg)

    # Claude Code always names a claude-* model; anything else is a deliberate
    # override (`claude --model zai-org/GLM-5.3`) and goes upstream verbatim.
    asked = req.get("model") or ""
    model = MODEL if (not asked or asked.startswith("claude")) else asked

    if system_parts:
        messages.insert(0, {"role": "system", "content": "\n\n".join(system_parts)})

    body = {
        "model": model,
        "messages": messages,
        "stream": bool(req.get("stream")),
    }
    if req.get("max_tokens"):
        body["max_tokens"] = req["max_tokens"]
    if req.get("temperature") is not None:
        body["temperature"] = req["temperature"]
    if req.get("stop_sequences"):
        body["stop"] = req["stop_sequences"]

    if req.get("tools"):
        body["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": t.get("name"),
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {"type": "object"}),
                },
            }
            for t in req["tools"]
            if t.get("name")
        ]
        tc = req.get("tool_choice") or {}
        kind = tc.get("type")
        if kind == "auto":
            body["tool_choice"] = "auto"
        elif kind == "any":
            body["tool_choice"] = "required"
        elif kind == "tool" and tc.get("name"):
            body["tool_choice"] = {"type": "function", "function": {"name": tc["name"]}}

    if body["stream"]:
        body["stream_options"] = {"include_usage": True}
    return body


def upstream(body, stream):
    data = json.dumps(body).encode()
    r = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=data,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
        },
        method="POST",
    )
    return urllib.request.urlopen(r, timeout=900, context=SSL_CTX)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # --- small helpers -------------------------------------------------
    def _json(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _err(self, code, message, kind="api_error"):
        log(f"[relay] error {code}: {message}")
        self._json(code, {"type": "error", "error": {"type": kind, "message": message}})

    def _sse(self, event, obj):
        chunk = f"event: {event}\ndata: {json.dumps(obj)}\n\n".encode()
        self.wfile.write(chunk)
        self.wfile.flush()

    # --- routes --------------------------------------------------------
    def do_GET(self):
        if self.path.startswith("/health"):
            return self._json(200, {"ok": True, "model": MODEL, "upstream": BASE_URL})
        return self._err(404, f"no route for GET {self.path}", "not_found_error")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            req = json.loads(raw) if raw else {}
        except Exception as e:
            return self._err(400, f"could not parse request body: {e}", "invalid_request_error")

        if self.path.startswith("/v1/messages/count_tokens"):
            approx = len(json.dumps(req)) // 4
            return self._json(200, {"input_tokens": approx})

        if not self.path.startswith("/v1/messages"):
            return self._err(404, f"no route for POST {self.path}", "not_found_error")

        if not API_KEY:
            return self._err(401, "NEBIUS_API_KEY is not set in the relay process",
                             "authentication_error")
        if not req.get("messages"):
            return self._err(400, "request has no messages", "invalid_request_error")

        body = to_openai(req)
        log(f"[relay] /v1/messages model={body['model']} msgs={len(body['messages'])} "
            f"tools={len(body.get('tools') or [])} stream={body['stream']} "
            f"asked_for={req.get('model')}")

        try:
            resp = upstream(body, body["stream"])
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:2000]
            log("[relay] rejected roles: " + ",".join(
                m["role"] + ("+tc" if m.get("tool_calls") else "")
                + ("" if m.get("content") else "/empty")
                for m in body["messages"]))
            return self._err(e.code, f"upstream {e.code}: {detail}")
        except Exception as e:
            return self._err(502, f"upstream unreachable: {e}")

        if body["stream"]:
            return self._stream(resp)
        return self._once(resp)

    # --- non-streaming ---------------------------------------------------
    def _once(self, resp):
        try:
            data = json.loads(resp.read())
        except Exception as e:
            return self._err(502, f"upstream returned an unreadable body: {e}")
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        blocks = []
        if msg.get("content"):
            blocks.append({"type": "text", "text": msg["content"]})
        for c in msg.get("tool_calls") or []:
            fn = c.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except Exception:
                args = {}
            blocks.append({"type": "tool_use", "id": c.get("id", ""),
                           "name": fn.get("name", ""), "input": args})
        usage = data.get("usage") or {}
        self._json(200, {
            "id": data.get("id", "msg_relay"),
            "type": "message",
            "role": "assistant",
            "model": data.get("model", MODEL),
            "content": blocks,
            "stop_reason": stop_reason_for(choice.get("finish_reason"),
                                           bool(msg.get("tool_calls"))),
            "stop_sequence": None,
            "usage": {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
            },
        })

    # --- streaming -------------------------------------------------------
    def _stream(self, resp):
        # No Content-Length is possible on a stream, and this server does not
        # speak chunked encoding: without an explicit close the client waits
        # for a body end that never comes. Claude Code hung on exactly that.
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        mid = f"msg_relay_{int(time.time()*1000)}"
        self._sse("message_start", {
            "type": "message_start",
            "message": {"id": mid, "type": "message", "role": "assistant",
                        "model": "relay", "content": [], "stop_reason": None,
                        "stop_sequence": None,
                        "usage": {"input_tokens": 0, "output_tokens": 0}},
        })

        seen_text = []      # debug: what we actually forwarded
        index = -1          # current Anthropic content block index
        open_kind = None    # "text" | "tool"
        tool_slot = {}      # upstream tool_calls index -> our block index
        finish = "stop"
        out_tokens = 0
        in_tokens = 0

        def close_block():
            nonlocal open_kind
            if open_kind is not None:
                self._sse("content_block_stop", {"type": "content_block_stop", "index": index})
                open_kind = None

        try:
            for line in resp:
                line = line.decode(errors="replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    ev = json.loads(payload)
                except Exception:
                    log(f"[relay] unparsable upstream chunk: {payload[:200]}")
                    continue

                usage = ev.get("usage") or {}
                if usage.get("completion_tokens"):
                    out_tokens = usage["completion_tokens"]
                if usage.get("prompt_tokens"):
                    in_tokens = usage["prompt_tokens"]

                choice = (ev.get("choices") or [{}])[0]
                if choice.get("finish_reason"):
                    finish = choice["finish_reason"]
                delta = choice.get("delta") or {}

                piece = delta.get("content")
                if piece:
                    if open_kind != "text":
                        close_block()
                        index += 1
                        open_kind = "text"
                        self._sse("content_block_start", {
                            "type": "content_block_start", "index": index,
                            "content_block": {"type": "text", "text": ""}})
                    seen_text.append(piece)
                    self._sse("content_block_delta", {
                        "type": "content_block_delta", "index": index,
                        "delta": {"type": "text_delta", "text": piece}})

                for call in delta.get("tool_calls") or []:
                    slot = call.get("index", 0)
                    fn = call.get("function") or {}
                    if slot not in tool_slot:
                        close_block()
                        index += 1
                        open_kind = "tool"
                        tool_slot[slot] = index
                        self._sse("content_block_start", {
                            "type": "content_block_start", "index": index,
                            "content_block": {"type": "tool_use",
                                              "id": call.get("id") or f"toolu_{mid}_{slot}",
                                              "name": fn.get("name", ""), "input": {}}})
                    args = fn.get("arguments")
                    if args:
                        self._sse("content_block_delta", {
                            "type": "content_block_delta", "index": tool_slot[slot],
                            "delta": {"type": "input_json_delta", "partial_json": args}})

            close_block()
            stop = stop_reason_for(finish, bool(tool_slot))
            self._sse("message_delta", {
                "type": "message_delta",
                "delta": {"stop_reason": stop, "stop_sequence": None},
                # input_tokens too: the client tracks how full its context is
                # from what the stream reports, and a hardcoded zero every turn
                # hides that entirely.
                "usage": {"input_tokens": in_tokens, "output_tokens": out_tokens}})
            self._sse("message_stop", {"type": "message_stop"})
            log(f"[relay] stream done finish={finish} stop={stop} blocks={index + 1} "
                f"in_tokens={in_tokens} out_tokens={out_tokens} "
                f"chars={len(''.join(seen_text))}")
        except Exception as e:
            log(f"[relay] stream aborted: {e}")


if __name__ == "__main__":
    if not API_KEY:
        log("[relay] warning: NEBIUS_API_KEY is empty; /v1/messages will answer 401")
    log(f"[relay] listening on 127.0.0.1:{PORT} -> {BASE_URL} model={MODEL}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
