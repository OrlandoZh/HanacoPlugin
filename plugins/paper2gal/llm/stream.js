import { StreamError } from "./errors.js";

/**
 * llm/stream.js — SSE 流式解析器
 *
 * 对应原文 §7 的流式输出逻辑。
 * 封装为可复用的 AsyncGenerator，支持：
 *   - OpenAI-compatible SSE（data: 行）
 *   - Anthropic SSE（event: 行 + data: 行）
 *   - 取消信号（AbortSignal）
 *   - 自动区分 delta / usage / done
 */

/**
 * 对流式响应进行 SS 解析，yield 结构化 Chunk。
 *
 * @param {Response}      fetchResponse  fetch 返回的 Response 对象
 * @param {AbortSignal}   [signal]       取消信号
 * @yields {StreamChunk}
 *
 * @typedef {{ type:"delta", content:string }|{ type:"usage", input:number, output:number }|{ type:"done" }} StreamChunk
 */
export async function* parseSSE(fetchResponse, signal) {
  if (!fetchResponse.ok) {
    const text = await fetchResponse.text().catch(() => "");
    throw new StreamError(`HTTP ${fetchResponse.status}: ${text.slice(0, 200)}`);
  }

  const reader = fetchResponse.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;

  // 订阅外部取消
  const cleanup = signal
    ? signal.addEventListener("abort", () => reader.cancel(), { once: true })
    : null;

  try {
    while (!done) {
      const { done: readerDone, value } = await reader.read();
      if (readerDone) break;

      buf += decoder.decode(value, { stream: true });

      // 按行切分
      while (buf.includes("\n")) {
        const nlIdx = buf.indexOf("\n");
        const line = buf.slice(0, nlIdx).trimEnd();
        buf = buf.slice(nlIdx + 1);

        if (!line) continue; // 空行 = SSE 消息分隔

        const parsed = parseSSELine(line);
        if (!parsed) continue;

        // 处理不同事件类型
        if (parsed.event === "done" || parsed.data === "[DONE]") {
          yield { type: "done" };
          return;
        }

        // 尝试解析 data JSON
        let json;
        try {
          json = JSON.parse(parsed.data);
        } catch {
          continue; // 非 JSON 行跳过
        }

        // OpenAI-compatible delta
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          yield { type: "delta", content: delta };
        }

        // usage（在流式末尾）
        if (json.usage) {
          yield {
            type: "usage",
            input: json.usage.prompt_tokens || json.usage.input_tokens || 0,
            output: json.usage.completion_tokens || json.usage.output_tokens || 0,
          };
        }

        // Anthropic content_block_delta
        if (json.type === "content_block_delta" && json.delta?.text) {
          yield { type: "delta", content: json.delta.text };
        }

        // Anthropic message_stop → done
        if (json.type === "message_stop") {
          yield { type: "done" };
          return;
        }

        // Anthropic message_start → 可能含 usage
        if (json.type === "message_start" && json.message?.usage) {
          yield {
            type: "usage",
            input: json.message.usage.input_tokens || 0,
            output: json.message.usage.output_tokens || 0,
          };
        }

        // Anthropic message_delta → 可能含 usage
        if (json.type === "message_delta" && json.usage) {
          yield {
            type: "usage",
            input: 0, // Anthropic 只在 message_start 有 input
            output: json.usage.output_tokens || 0,
          };
        }
      }
    }

    // 流正常结束
    yield { type: "done" };

  } catch (err) {
    if (err.name === "AbortError") return;
    throw new StreamError(err);
  } finally {
    if (cleanup) signal.removeEventListener("abort", cleanup);
    reader.releaseLock();
  }
}

/**
 * 解析单行 SSE 文本。
 * 支持 event: / data: 两种前缀。
 *
 * @param {string} line
 * @returns {{event?:string, data?:string}|null}
 */
function parseSSELine(line) {
  if (line.startsWith("data: ")) {
    return { data: line.slice(6) };
  }
  if (line.startsWith("event: ")) {
    return { event: line.slice(7) };
  }
  // 忽略其他行（如 :ok-comment、id:、retry:）
  return null;
}
