import { Agent } from "@cursor/sdk";
import { type NextRequest, NextResponse } from "next/server";

const DEEP_RESEARCH_PROMPT = `You are a deep research assistant. When given a research question or topic, you will:

1. Analyze the question and identify key sub-topics to investigate
2. Systematically search for information using all available tools
3. Explore multiple angles, perspectives, and sources
4. Synthesize findings into a comprehensive, well-structured research report

Your final report must:
- Start with an executive summary
- Include detailed sections covering different aspects of the topic
- Cite sources and evidence for major claims
- Draw evidence-based conclusions
- Be formatted with clear headers (using ## for sections, ### for subsections)

Research thoroughly and deeply before writing your final report. Explore the topic from many angles.`;

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  let query: string;
  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query.trim() : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "CURSOR_API_KEY environment variable is not set" },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: object) =>
        controller.enqueue(encoder.encode(sseEvent(data)));

      let agent;
      try {
        try {
          agent = await Agent.create({
            apiKey,
            name: "Deep Research",
            cloud: {},
          });
        } catch (createErr) {
          const msg = createErr instanceof Error ? createErr.message : String(createErr);
          throw new Error(`Failed to create Cursor agent: ${msg}`);
        }

        enqueue({ type: "status", message: "Agent created, starting research…" });

        const run = await agent.send(
          `${DEEP_RESEARCH_PROMPT}\n\nResearch question: ${query}`,
        );

        for await (const message of run.stream()) {
          if (message.type === "thinking") {
            enqueue({ type: "thinking", text: message.text });
          } else if (message.type === "tool_call") {
            enqueue({
              type: "tool",
              name: message.name,
              status: message.status,
              args: message.args,
            });
          } else if (message.type === "assistant") {
            for (const block of message.message.content) {
              if (block.type === "text") {
                enqueue({ type: "text", delta: block.text });
              }
            }
          } else if (message.type === "status") {
            enqueue({ type: "status", message: message.message ?? message.status });
          } else if (message.type === "task") {
            enqueue({ type: "task", text: message.text ?? "", status: message.status });
          }
        }

        const result = await run.wait();
        enqueue({ type: "done", status: result.status, result: result.result ?? "" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        enqueue({ type: "error", message });
      } finally {
        try {
          agent?.close();
        } catch {
          // Ignore cleanup errors
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
