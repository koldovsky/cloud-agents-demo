"use client";

import { FormEvent, useState } from "react";

type ResearchEvent =
  | { type: "metadata"; agentId: string; runId: string }
  | { type: "status"; status: string; message?: string }
  | { type: "task"; status?: string; text?: string }
  | { type: "tool"; name: string; status: string }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "done"; status: string; durationMs?: number; result?: string }
  | { type: "error"; message: string };

const depthOptions = [
  {
    value: "quick",
    label: "Quick scan",
    description: "Short synthesis with likely tradeoffs.",
  },
  {
    value: "standard",
    label: "Standard research",
    description: "Balanced report with findings and caveats.",
  },
  {
    value: "deep",
    label: "Deep research",
    description: "Expanded evidence, counterpoints, and open questions.",
  },
];

export default function Home() {
  const [topic, setTopic] = useState(
    "What are the current best practices for using AI coding agents in a production engineering workflow?",
  );
  const [depth, setDepth] = useState("standard");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!topic.trim()) {
      setError("Enter a research question first.");
      return;
    }

    setAnswer("");
    setThinking("");
    setEvents([]);
    setError("");
    setIsRunning(true);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, depth }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Research request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() ?? "";

        for (const message of messages) {
          const parsed = parseServerSentEvent(message);
          if (parsed) applyResearchEvent(parsed);
        }
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Research request failed.",
      );
    } finally {
      setIsRunning(false);
    }
  }

  function applyResearchEvent(payload: ResearchEvent) {
    switch (payload.type) {
      case "text":
        setAnswer((current) => current + payload.text);
        return;
      case "thinking":
        setThinking((current) => current + payload.text);
        return;
      case "metadata":
        setEvents((current) => [
          ...current,
          `Started Cursor agent ${payload.agentId} run ${payload.runId}`,
        ]);
        return;
      case "status":
        setEvents((current) => [
          ...current,
          payload.message
            ? `${payload.status}: ${payload.message}`
            : payload.status,
        ]);
        return;
      case "task":
        if (!payload.text && !payload.status) return;
        setEvents((current) => [
          ...current,
          [payload.status, payload.text].filter(Boolean).join(": "),
        ]);
        return;
      case "tool":
        setEvents((current) => [
          ...current,
          `${payload.name} ${payload.status}`,
        ]);
        return;
      case "done":
        setEvents((current) => [
          ...current,
          payload.durationMs
            ? `Finished in ${Math.round(payload.durationMs / 1000)}s`
            : `Finished with status ${payload.status}`,
        ]);
        return;
      case "error":
        setError(payload.message);
        return;
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-10 sm:px-10 lg:py-16">
        <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div className="space-y-5">
            <p className="w-fit rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100">
              Cursor SDK research agent
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Deep research for engineering questions.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-300">
              Ask a broad question and stream a Cursor agent as it plans,
              investigates, and writes a structured research report.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/10 p-5 shadow-2xl shadow-cyan-950/30 backdrop-blur">
            <p className="text-sm font-medium uppercase tracking-[0.3em] text-cyan-200">
              Setup
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Add <span className="font-mono text-cyan-100">CURSOR_API</span>{" "}
              to <span className="font-mono text-cyan-100">.env</span>. The
              server route passes it to the Cursor TypeScript SDK.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950"
          >
            <label
              htmlFor="topic"
              className="text-sm font-semibold text-slate-100"
            >
              Research question
            </label>
            <textarea
              id="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={8}
              className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-slate-950 p-4 text-base leading-7 text-white outline-none transition focus:border-cyan-300"
              placeholder="Ask about a market, technical decision, architecture, or workflow..."
            />

            <fieldset className="mt-6 space-y-3">
              <legend className="text-sm font-semibold text-slate-100">
                Research depth
              </legend>
              {depthOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:bg-white/[0.06]"
                >
                  <input
                    type="radio"
                    name="depth"
                    value={option.value}
                    checked={depth === option.value}
                    onChange={(event) => setDepth(event.target.value)}
                    className="mt-1 size-4 accent-cyan-300"
                  />
                  <span>
                    <span className="block font-medium text-white">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-slate-400">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <button
              type="submit"
              disabled={isRunning}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-cyan-300 px-5 font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {isRunning ? "Researching..." : "Start research"}
            </button>
            {error ? (
              <p className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">
                {error}
              </p>
            ) : null}
          </form>

          <section className="grid gap-6">
            <article className="flex h-[36rem] flex-col rounded-3xl border border-white/10 bg-white p-6 text-slate-950 shadow-2xl shadow-slate-950">
              <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-xl font-semibold">Research report</h2>
                  <p className="text-sm text-slate-500">
                    Streamed from Cursor SDK assistant messages.
                  </p>
                </div>
                {isRunning ? (
                  <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-medium text-cyan-800">
                    Live
                  </span>
                ) : null}
              </div>
              <div
                data-testid="research-report"
                className="prose prose-slate mt-5 max-w-none flex-1 overflow-auto whitespace-pre-wrap pr-2 text-sm leading-7"
              >
                {answer ||
                  "The research report will appear here as the Cursor agent streams its response."}
              </div>
            </article>

            <div className="grid gap-6 md:grid-cols-2">
              <article className="rounded-3xl border border-white/10 bg-slate-900/90 p-5">
                <h2 className="font-semibold text-white">Agent activity</h2>
                <ul className="mt-4 max-h-48 space-y-3 overflow-auto text-sm text-slate-300">
                  {events.length ? (
                    events.map((item, index) => (
                      <li key={`${item}-${index}`}>{item}</li>
                    ))
                  ) : (
                    <li>Waiting for a research run.</li>
                  )}
                </ul>
              </article>
              <article className="rounded-3xl border border-white/10 bg-slate-900/90 p-5">
                <h2 className="font-semibold text-white">Research notes</h2>
                <p className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {thinking ||
                    "Cursor SDK thinking events will appear here when the selected model exposes them."}
                </p>
              </article>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function parseServerSentEvent(message: string): ResearchEvent | null {
  const dataLine = message
    .split("\n")
    .find((line) => line.startsWith("data: "));

  if (!dataLine) return null;

  try {
    return JSON.parse(dataLine.slice(6)) as ResearchEvent;
  } catch {
    return null;
  }
}
