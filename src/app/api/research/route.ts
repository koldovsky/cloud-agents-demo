import { Agent } from "@cursor/sdk";
import type { SDKMessage } from "@cursor/sdk";

export const runtime = "nodejs";
export const maxDuration = 300;

const encoder = new TextEncoder();

type ResearchDepth = "quick" | "standard" | "deep";

type ResearchEvent =
  | { type: "metadata"; agentId: string; runId: string }
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string; status: "running" | "completed" | "error" }
  | { type: "status"; status: string; message?: string }
  | { type: "task"; status?: string; text?: string }
  | { type: "done"; status: string; durationMs?: number }
  | { type: "error"; message: string };

function streamEvent(event: ResearchEvent) {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function getCursorApiKey() {
  return process.env.CURSOR_API ?? process.env.CURSOR_API_KEY;
}

function normalizeDepth(depth: unknown): ResearchDepth {
  return depth === "quick" || depth === "deep" ? depth : "standard";
}

function buildResearchPrompt(topic: string, depth: ResearchDepth) {
  const depthInstructions = {
    quick: "Keep the report concise: prioritize the strongest findings and only include critical caveats.",
    standard: "Write a balanced report with enough evidence to support each finding and its caveats.",
    deep: "Go deeper than a summary: include counterarguments, uncertainty, alternative interpretations, and follow-up research paths.",
  } satisfies Record<ResearchDepth, string>;

  return `You are a deep research assistant. Investigate the topic below with the same care as a senior research analyst.

Topic:
${topic}

Research depth:
${depthInstructions[depth]}

Return a structured report with:
1. Executive summary
2. Key findings with confidence levels
3. Important context and tradeoffs
4. Open questions or unknowns
5. Suggested next steps

Use available tools to inspect the local workspace when relevant. Be explicit when a claim is based on inference rather than direct evidence.`;
}

function messageToEvents(message: SDKMessage): ResearchEvent[] {
  switch (message.type) {
    case "assistant":
      return message.message.content.flatMap((block) =>
        block.type === "text" ? [{ type: "text", text: block.text }] : [],
      );
    case "thinking":
      if (message.text.includes("Cannot show a resolved agent reasoning stream")) {
        return [];
      }

      return [{ type: "thinking", text: message.text }];
    case "tool_call":
      return [
        {
          type: "tool",
          name: message.name,
          status: message.status,
        },
      ];
    case "status":
      return [
        {
          type: "status",
          status: message.status,
          message: message.message,
        },
      ];
    case "task":
      return message.text
        ? [{ type: "task", status: message.status, text: message.text }]
        : [];
    default:
      return [];
  }
}

export async function POST(request: Request) {
  const { topic, depth } = (await request.json().catch(() => ({}))) as {
    topic?: unknown;
    depth?: unknown;
  };
  const normalizedTopic = typeof topic === "string" ? topic.trim() : "";
  const researchDepth = normalizeDepth(depth);
  const apiKey = getCursorApiKey();

  if (!normalizedTopic) {
    return Response.json({ error: "Enter a research topic." }, { status: 400 });
  }

  if (!apiKey) {
    return Response.json(
      { error: "Set CURSOR_API in .env to use the Cursor SDK." },
      { status: 500 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;

      try {
        agent = await Agent.create({
          apiKey,
          model: { id: "composer-2" },
          local: { cwd: process.cwd() },
          name: "Deep Research",
        });

        const run = await agent.send(
          buildResearchPrompt(normalizedTopic, researchDepth),
        );

        controller.enqueue(
          streamEvent({
            type: "metadata",
            agentId: agent.agentId,
            runId: run.id,
          }),
        );

        for await (const message of run.stream()) {
          for (const event of messageToEvents(message)) {
            controller.enqueue(streamEvent(event));
          }
        }

        const result = await run.wait();
        controller.enqueue(
          streamEvent({
            type: "done",
            status: result.status,
            durationMs: result.durationMs,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Research failed.";
        controller.enqueue(streamEvent({ type: "error", message }));
      } finally {
        await agent?.[Symbol.asyncDispose]();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
