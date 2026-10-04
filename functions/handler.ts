// MiMo 语音工坊 · 站点服务端代理
// 浏览器只与同源 /functions/v1/app 通信；上游接入点由服务端决定，不接受浏览器传入的 URL。

const ENDPOINTS: Record<string, string> = {
  pay: "https://api.xiaomimimo.com/v1",
  token: "https://token-plan-cn.xiaomimimo.com/v1",
};

const MODELS = new Set([
  "mimo-v2.5-tts",
  "mimo-v2.5-tts-voicedesign",
  "mimo-v2.5-tts-voiceclone",
]);

const ROLES = new Set(["user", "assistant"]);
const FORMATS = new Set(["wav", "pcm16"]);
const AUDIO_KEYS = new Set(["voice", "format", "optimize_text_preview"]);

const MAX_BODY = 26 * 1024 * 1024; // 10MB 样本 base64 后约 13.4MB
const MAX_TEXT = 20000;
const MAX_VOICE_NAME = 120;
const MAX_DATA_URL = 15 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 300000;

function envGet(name: string): string {
  const g = globalThis as any;
  if (typeof g.Deno !== "undefined" && g.Deno?.env?.get) return g.Deno.env.get(name) || "";
  return g.process?.env?.[name] || "";
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function fail(error: string, message: string, status = 400, detail = ""): Response {
  return json({ ok: false, error, message, detail }, status);
}

function detectKeyType(key: string): string {
  if (/^tp-/.test(key)) return "token";
  if (/^sk-/.test(key)) return "pay";
  return "";
}

// 自定义接入点仅由服务端环境变量提供，且必须是干净的 http(s) 源。
function configuredBase(): string {
  const raw = envGet("MIMO_BASE_URL").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password) return "";
    return u.origin + (u.pathname === "/" ? "" : u.pathname.replace(/\/$/, ""));
  } catch {
    return "";
  }
}

function baseUrlFor(kind: string): string {
  return configuredBase() || ENDPOINTS[kind];
}

function isInlineDataUrl(v: string): boolean {
  return /^data:audio\/(mpeg|wav|x-wav);base64,[A-Za-z0-9+/=\s]{1,}$/.test(v);
}

function validateRequest(body: any): { payload: Record<string, unknown>; hasVoiceData: boolean } | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "请求体不是合法 JSON 对象";

  const model = body.model;
  if (typeof model !== "string" || !MODELS.has(model)) return "不支持的模型";

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) {
    return "messages 需为 1–4 条消息";
  }
  const cleanMessages: Array<{ role: string; content: string }> = [];
  let assistantCount = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object") return "消息格式不合法";
    if (typeof m.role !== "string" || !ROLES.has(m.role)) return "消息角色仅支持 user / assistant";
    if (typeof m.content !== "string") return "消息内容需为字符串";
    if (m.content.length === 0 || m.content.length > MAX_TEXT) return "消息内容长度需在 1–" + MAX_TEXT + " 字符之间";
    if (m.role === "assistant") assistantCount++;
    cleanMessages.push({ role: m.role, content: m.content });
  }
  // 音色设计允许只有描述（由接口智能润色生成试听文本），其余模型必须带一条 assistant 文本。
  if (model === "mimo-v2.5-tts-voicedesign") {
    if (assistantCount > 1) return "音色设计最多一条 assistant 试听文本";
  } else if (assistantCount !== 1) {
    return "必须且只能有一条 assistant 文本消息";
  }

  const srcAudio = body.audio;
  const audio: Record<string, unknown> = {};
  let hasVoiceData = false;
  if (srcAudio !== undefined && srcAudio !== null) {
    if (typeof srcAudio !== "object" || Array.isArray(srcAudio)) return "audio 需为对象";
    for (const key of Object.keys(srcAudio)) {
      if (!AUDIO_KEYS.has(key)) return "audio 含不支持的字段：" + key;
    }
    const format = srcAudio.format;
    if (format !== undefined) {
      if (typeof format !== "string" || !FORMATS.has(format)) return "audio.format 仅支持 wav / pcm16";
      audio.format = format;
    }
    const optimize = srcAudio.optimize_text_preview;
    if (optimize !== undefined) {
      if (typeof optimize !== "boolean") return "audio.optimize_text_preview 需为布尔值";
      audio.optimize_text_preview = optimize;
    }
    const voice = srcAudio.voice;
    if (voice !== undefined) {
      if (typeof voice !== "string") return "audio.voice 需为字符串";
      if (voice.startsWith("data:")) {
        if (voice.length > MAX_DATA_URL) return "音色样本超过 10 MB";
        if (!isInlineDataUrl(voice)) return "音色样本仅支持 base64 的 MP3 / WAV";
        hasVoiceData = true;
      } else if (voice.length === 0 || voice.length > MAX_VOICE_NAME) {
        return "音色名称不合法";
      }
      audio.voice = voice;
    }
  }

  const payload: Record<string, unknown> = { model, messages: cleanMessages };
  if (Object.keys(audio).length) payload.audio = audio;
  if (body.stream === true) payload.stream = true;
  return { payload, hasVoiceData };
}

function upstreamError(status: number, detail: string): Response {
  let message = "上游 MiMo 接口返回 " + status;
  let brief = detail.slice(0, 1200);
  try {
    const parsed = JSON.parse(detail);
    const e = parsed && parsed.error;
    if (e) {
      message = e.message || message;
      brief = String(e.detail || (typeof e === "string" ? e : "") || "").slice(0, 1200);
    }
  } catch {
    /* 上游返回非 JSON 时保留原文摘要 */
  }
  const code = status >= 400 && status < 600 ? status : 502;
  return json({ ok: false, error: "upstream_error", message, detail: brief }, code);
}

async function handleTts(request: Request): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail("invalid_body", "无法读取请求体");
  }
  if (raw.length > MAX_BODY) return fail("body_too_large", "请求体过大，克隆样本请控制在 10 MB 以内", 413);

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail("invalid_body", "请求体不是合法 JSON");
  }

  const validated = validateRequest(body);
  if (typeof validated === "string") return fail("invalid_request", validated);
  const { payload, hasVoiceData } = validated;

  const browserKey = typeof body.apiKey === "string" ? body.apiKey.trim().slice(0, 200) : "";
  if (browserKey && /[\s\x00-\x1f]/.test(browserKey)) {
    return fail("invalid_key", "API Key 格式不合法");
  }
  const serverKey = envGet("MIMO_API_KEY").trim();
  const apiKey = browserKey || serverKey;
  if (!apiKey) {
    return fail("key_required", "尚未配置 MiMo API Key：请在「设置」填入，或由站点所有者配置服务端密钥", 401);
  }

  let kind = typeof body.endpoint === "string" ? body.endpoint : "auto";
  if (kind !== "auto" && kind !== "pay" && kind !== "token") return fail("invalid_request", "endpoint 仅支持 auto / pay / token");
  if (kind === "auto") kind = detectKeyType(apiKey) || detectKeyType(serverKey) || (envGet("MIMO_ENDPOINT") === "token" ? "token" : "pay");
  const base = baseUrlFor(kind);
  if (!base) return fail("service_not_configured", "服务端未配置 MiMo 接入点", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
        Accept: payload.stream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as any)?.name === "AbortError";
    console.error("[tts] 上游请求失败", aborted ? "timeout" : String((err as any)?.message || err));
    return fail("upstream_unreachable", aborted ? "合成超时，请缩短文本后重试" : "无法连接 MiMo 接口，请稍后重试", 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    clearTimeout(timer);
    console.error("[tts] 上游返回", upstream.status, hasVoiceData ? "clone" : "voice");
    return upstreamError(upstream.status, detail);
  }

  const type = upstream.headers.get("content-type") || "";
  console.log("[tts] 合成成功", payload.model, type.includes("event-stream") ? "stream" : "json");
  if (payload.stream) {
    clearTimeout(timer);
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": type.includes("event-stream") ? type : "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }
  const result = new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  clearTimeout(timer);
  return result;
}

export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "ping";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
  }

  if (action === "ping") {
    if (request.method !== "GET") return fail("method_not_allowed", "仅支持 GET", 405);
    return json({
      ok: true,
      service: "mimo-voice-studio",
      serverKey: Boolean(envGet("MIMO_API_KEY").trim()),
      endpoint: configuredBase() ? "custom" : "official",
      models: Array.from(MODELS),
    }, 200);
  }

  if (action === "tts") {
    if (request.method !== "POST") return fail("method_not_allowed", "仅支持 POST", 405);
    return handleTts(request);
  }

  return fail("not_found", "未知的服务入口", 404);
}
