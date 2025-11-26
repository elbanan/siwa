/**
 * GENERATE tab - choose model, set params, run inference.
 */

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import api from "../../lib/api";
import { ModelEntry } from "../../types/model";
import { GenerationTask } from "../../types/generation";

type GenerateResult = {
  model_id: string;
  provider: string;
  output: string;
  raw_output?: Record<string, any> | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  raw?: Record<string, any> | null;
};

const DEFAULT_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  max_tokens: 256,
  presence_penalty: 0,
  frequency_penalty: 0,
};

const buildTaskForm = (modelId?: string) => ({
  name: "",
  description: "",
  model_id: modelId || "",
  system_prompt: "",
  params: { ...DEFAULT_PARAMS },
});

export default function GeneratePage() {
  const { status } = useSession();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [taskForm, setTaskForm] = useState(buildTaskForm());
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskError, setTaskError] = useState("");

  const [sessionParams, setSessionParams] = useState({ ...DEFAULT_PARAMS });
  const [sessionSystemPrompt, setSessionSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runError, setRunError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const modelMap = useMemo(() => {
    const map: Record<string, ModelEntry> = {};
    models.forEach((m) => (map[m.id] = m));
    return map;
  }, [models]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  const selectedModel = selectedTask ? modelMap[selectedTask.model_id] : undefined;
  const latestAssistant = useMemo(() => getLatestAssistant(messages), [messages]);

  useEffect(() => {
    if (status !== "authenticated") return;
    api
      .get<ModelEntry[]>("/models")
      .then((res) => {
        setModels(res.data);
        setTaskForm((prev) =>
          prev.model_id ? prev : buildTaskForm(res.data[0]?.id)
        );
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Failed to load models";
        setTaskError(detail);
      });
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    api
      .get<GenerationTask[]>("/generation-tasks")
      .then((res) => {
        setTasks(res.data);
        if (!selectedTaskId && res.data.length) {
          setSelectedTaskId(res.data[0].id);
        }
      })
      .catch((e) => {
        const detail = e?.response?.data?.detail ?? "Failed to load sessions";
        setTaskError(detail);
      });
  }, [status]);

  useEffect(() => {
    if (!selectedTask) {
      setMessages([]);
      return;
    }
    setSessionParams({
      ...DEFAULT_PARAMS,
      ...selectedTask.params,
    });
    setSessionSystemPrompt(selectedTask.system_prompt || "");
    setUserPrompt("");
    setMessages([]);
    setRunError("");
  }, [selectedTask]);

  const handleCreateTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!taskForm.name.trim()) {
      setTaskError("Name is required.");
      return;
    }
    if (!taskForm.model_id) {
      setTaskError("Select a model.");
      return;
    }
    setCreatingTask(true);
    setTaskError("");
    try {
      const res = await api.post<GenerationTask>("/generation-tasks", taskForm);
      setTasks((prev) => [res.data, ...prev]);
      setSelectedTaskId(res.data.id);
      setTaskForm(buildTaskForm(taskForm.model_id));
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to create session";
      setTaskError(detail);
    } finally {
      setCreatingTask(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    setDeletingTaskId(taskId);
    setTaskError("");
    try {
      await api.delete(`/generation-tasks/${taskId}`);
      setTasks((prev) => {
        const updated = prev.filter((t) => t.id !== taskId);
        if (taskId === selectedTaskId) {
          setSelectedTaskId(updated[0]?.id ?? "");
          setMessages([]);
        }
        return updated;
      });
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Failed to delete session";
      setTaskError(detail);
    } finally {
      setDeletingTaskId(null);
    }
  };

  const handleParamChange = (key: keyof typeof DEFAULT_PARAMS, value: number) => {
    if (Number.isNaN(value)) return;
    setSessionParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleResetSession = () => {
    if (!selectedTask) return;
    setSessionParams({
      ...DEFAULT_PARAMS,
      ...selectedTask.params,
    });
    setSessionSystemPrompt(selectedTask.system_prompt || "");
    setMessages([]);
    setUserPrompt("");
    setRunError("");
  };

  const handleGenerate = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedTask) {
      setRunError("Select a session to run.");
      return;
    }
    if (!userPrompt.trim()) {
      setRunError("Enter a user prompt.");
      return;
    }
    const prompt = composePrompt(sessionSystemPrompt, userPrompt);
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content: userPrompt,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setGenerating(true);
    setRunError("");
    setUserPrompt("");
    try {
      const res = await api.post<GenerateResult>("/generate", {
        model_id: selectedTask.model_id,
        prompt,
        params: sessionParams,
      });
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: res.data.output,
        raw: res.data.raw_output ?? null,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setExpandedMessageId(null);
    } catch (e: any) {
      const detail = e?.response?.data?.detail ?? "Generation failed";
      setRunError(detail);
      // Remove last user message if generation fails to keep context clean
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setGenerating(false);
    }
  };

  if (status === "unauthenticated") {
    return (
      <div className="bg-white border rounded-2xl p-10 text-center">
        <h1 className="text-xl font-semibold">Sign in required</h1>
        <p className="text-sm text-gray-600 mt-2">
          Sign in to run local models.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Generate</h1>
          <p className="text-sm text-gray-600 mt-1">
            Create reusable generation sessions with default settings, then interact with them as many times as you need.
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[320px,1fr] gap-6">
        <aside className="space-y-4">
          <div className="bg-white border rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Sessions</h2>
              <span className="text-xs text-gray-500">{tasks.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`w-full text-left border rounded-xl px-3 py-2 text-sm ${
                    task.id === selectedTaskId
                      ? "border-black bg-black text-white"
                      : "border-gray-200 hover:border-gray-400"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold truncate">{task.name}</span>
                    {task.id === selectedTaskId && (
                      <span className="text-xs text-gray-200">Active</span>
                    )}
                  </div>
                  {task.description && (
                    <p className={`text-xs mt-1 ${task.id === selectedTaskId ? "text-gray-200" : "text-gray-500"}`}>
                      {task.description}
                    </p>
                  )}
                  <p className={`text-xs mt-1 ${task.id === selectedTaskId ? "text-gray-200" : "text-gray-500"}`}>
                    Model: {modelMap[task.model_id]?.name ?? task.model_id}
                  </p>
                </button>
              ))}
              {!tasks.length && (
                <p className="text-sm text-gray-500">No sessions yet.</p>
              )}
            </div>
          </div>

          <form
            onSubmit={handleCreateTask}
            className="bg-white border rounded-2xl p-4 shadow-sm space-y-3"
          >
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              New session
            </h3>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Session name"
              value={taskForm.name}
              onChange={(e) => setTaskForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="Description (optional)"
              value={taskForm.description ?? ""}
              onChange={(e) =>
                setTaskForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={taskForm.model_id}
              onChange={(e) =>
                setTaskForm((prev) => ({ ...prev, model_id: e.target.value }))
              }
            >
              <option value="">Select model…</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} ({model.source_type})
                </option>
              ))}
            </select>
            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="System prompt (optional)"
              value={taskForm.system_prompt}
              onChange={(e) =>
                setTaskForm((prev) => ({ ...prev, system_prompt: e.target.value }))
              }
            />
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <NumberField
                label="Temperature"
                min={0}
                max={2}
                step={0.1}
                value={taskForm.params.temperature ?? DEFAULT_PARAMS.temperature}
                onChange={(val) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    params: { ...prev.params, temperature: val },
                  }))
                }
              />
              <NumberField
                label="Max tokens"
                min={1}
                max={4096}
                value={taskForm.params.max_tokens ?? DEFAULT_PARAMS.max_tokens}
                onChange={(val) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    params: { ...prev.params, max_tokens: val },
                  }))
                }
              />
              <NumberField
                label="Top P"
                min={0}
                max={1}
                step={0.05}
                value={taskForm.params.top_p ?? DEFAULT_PARAMS.top_p}
                onChange={(val) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    params: { ...prev.params, top_p: val },
                  }))
                }
              />
              <NumberField
                label="Top K"
                min={0}
                value={taskForm.params.top_k ?? DEFAULT_PARAMS.top_k}
                onChange={(val) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    params: { ...prev.params, top_k: val },
                  }))
                }
              />
              <NumberField
                label="Presence penalty"
                min={-2}
                max={2}
                step={0.1}
                value={taskForm.params.presence_penalty ?? DEFAULT_PARAMS.presence_penalty}
                onChange={(val) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    params: { ...prev.params, presence_penalty: val },
                  }))
                }
              />
              <NumberField
                label="Frequency penalty"
                min={-2}
                max={2}
                step={0.1}
                value={taskForm.params.frequency_penalty ?? DEFAULT_PARAMS.frequency_penalty}
                onChange={(val) =>
                  setTaskForm((prev) => ({
                    ...prev,
                    params: { ...prev.params, frequency_penalty: val },
                  }))
                }
              />
            </div>
            {taskError && (
              <p className="text-sm text-red-600">{taskError}</p>
            )}
            <button
              type="submit"
              disabled={creatingTask}
              className="w-full bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {creatingTask ? "Creating…" : "Create session"}
            </button>
          </form>
        </aside>

        <section className="space-y-4">
          {!selectedTask ? (
            <div className="bg-white border rounded-2xl p-10 text-center shadow-sm">
              <p className="text-gray-600 text-sm">
                Select or create a session to start generating.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-white border rounded-2xl p-4 shadow-sm flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase text-gray-500">Active session</p>
                  <h2 className="text-lg font-semibold">{selectedTask.name}</h2>
                  {selectedTask.description && (
                    <p className="text-sm text-gray-600">{selectedTask.description}</p>
                  )}
                  <p className="text-sm text-gray-500">
                    Model: {selectedModel?.name ?? selectedTask.model_id} • Defaults: temp {selectedTask.params.temperature ?? DEFAULT_PARAMS.temperature}, max tokens {selectedTask.params.max_tokens ?? DEFAULT_PARAMS.max_tokens}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleResetSession}
                    className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-50"
                  >
                    Reset session
                  </button>
                  <button
                    onClick={() => handleDeleteTask(selectedTask.id)}
                    disabled={deletingTaskId === selectedTask.id}
                    className={`text-sm px-3 py-1.5 rounded-md border ${
                      deletingTaskId === selectedTask.id
                        ? "bg-red-50 border-red-100 text-red-300 cursor-not-allowed"
                        : "border-red-200 text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {deletingTaskId === selectedTask.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>

              <form
                onSubmit={handleGenerate}
                className="bg-white border rounded-2xl p-5 shadow-sm space-y-4"
              >
                <div className="flex items-center justify-between border rounded-xl px-3 py-2 bg-gray-50">
                  <div>
                    <p className="text-xs uppercase text-gray-500">Session settings</p>
                    <p className="text-xs text-gray-600">
                      System prompt & decoding overrides
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSettings((prev) => !prev)}
                    className="text-sm px-3 py-1.5 rounded-md border hover:bg-gray-100"
                  >
                    {showSettings ? "Hide details" : "Show details"}
                  </button>
                </div>

                {showSettings && (
                  <div className="grid lg:grid-cols-2 gap-4 border rounded-xl p-4 bg-gray-50">
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-gray-700 flex items-center justify-between">
                        System prompt
                        <span className="text-xs text-gray-400">
                          Default from session; edit per run.
                        </span>
                      </label>
                      <textarea
                        className="w-full border rounded-lg px-3 py-2 text-sm min-h-[150px]"
                        placeholder="Set persona, policy, or guardrails…"
                        value={sessionSystemPrompt}
                        onChange={(e) => setSessionSystemPrompt(e.target.value)}
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Decoding overrides</p>
                      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mt-2">
                        <NumberField
                          label="Max tokens"
                          min={1}
                          max={4096}
                          value={sessionParams.max_tokens ?? DEFAULT_PARAMS.max_tokens}
                          onChange={(val) => handleParamChange("max_tokens", val)}
                        />
                        <NumberField
                          label="Temperature"
                          min={0}
                          max={2}
                          step={0.1}
                          value={sessionParams.temperature ?? DEFAULT_PARAMS.temperature}
                          onChange={(val) => handleParamChange("temperature", val)}
                        />
                        <NumberField
                          label="Top P"
                          min={0}
                          max={1}
                          step={0.05}
                          value={sessionParams.top_p ?? DEFAULT_PARAMS.top_p}
                          onChange={(val) => handleParamChange("top_p", val)}
                        />
                        <NumberField
                          label="Top K"
                          min={0}
                          value={sessionParams.top_k ?? DEFAULT_PARAMS.top_k}
                          onChange={(val) => handleParamChange("top_k", val)}
                        />
                        <NumberField
                          label="Presence penalty"
                          min={-2}
                          max={2}
                          step={0.1}
                          value={
                            sessionParams.presence_penalty ?? DEFAULT_PARAMS.presence_penalty
                          }
                          onChange={(val) => handleParamChange("presence_penalty", val)}
                        />
                        <NumberField
                          label="Frequency penalty"
                          min={-2}
                          max={2}
                          step={0.1}
                          value={
                            sessionParams.frequency_penalty ??
                            DEFAULT_PARAMS.frequency_penalty
                          }
                          onChange={(val) => handleParamChange("frequency_penalty", val)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <label className="text-sm font-medium text-gray-700">User prompt</label>
                  <textarea
                    className="w-full border rounded-lg px-3 py-2 text-sm min-h-[150px]"
                    placeholder="Ask a question or provide instructions…"
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                  />
                  {runError && <p className="text-sm text-red-600">{runError}</p>}
                  <button
                    type="submit"
                    disabled={generating}
                    className="bg-black text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800 disabled:opacity-50"
                  >
                    {generating ? "Generating…" : "Send prompt"}
                  </button>
                </div>
              </form>

              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2">
                <p className="text-xs uppercase text-gray-500">Latest response</p>
                {latestAssistant ? (
                  <>
                    <pre className="text-sm whitespace-pre-wrap font-sans">
                      {latestAssistant.content}
                    </pre>
                    {latestAssistant.raw && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedMessageId((prev) =>
                            prev === latestAssistant.id ? null : latestAssistant.id
                          )
                        }
                        className="text-xs text-black underline underline-offset-4"
                      >
                        {expandedMessageId === latestAssistant.id ? "Hide raw" : "Show raw"}
                      </button>
                    )}
                    {expandedMessageId === latestAssistant.id && (
                      <pre className="bg-white border rounded-lg p-2 text-xs overflow-x-auto">
                        {JSON.stringify(latestAssistant.raw, null, 2)}
                      </pre>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-600">No responses yet.</p>
                )}
              </div>

              <div className="bg-white border rounded-2xl p-4 shadow-sm">
                <p className="text-xs uppercase text-gray-500">Session history</p>
                {messages.length === 0 ? (
                  <p className="text-sm text-gray-600 mt-2">No exchanges yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {[...messages]
                      .slice()
                      .reverse()
                      .map((msg) => (
                      <div
                        key={msg.id}
                        className={`border rounded-xl p-3 text-sm ${
                          msg.role === "user"
                            ? "border-gray-200 bg-gray-50"
                            : "border-green-200 bg-green-50"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="uppercase font-semibold">{msg.role}</span>
                          <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap">{msg.content}</p>
                        {msg.role === "assistant" && msg.raw && (
                          <button
                            type="button"
                            className="text-xs text-black underline underline-offset-4 mt-2"
                            onClick={() =>
                              setExpandedMessageId((prev) =>
                                prev === msg.id ? null : msg.id
                              )
                            }
                          >
                            {expandedMessageId === msg.id ? "Hide raw" : "Show raw"}
                          </button>
                        )}
                        {msg.role === "assistant" &&
                          expandedMessageId === msg.id &&
                          msg.raw && (
                            <pre className="bg-white border rounded-lg p-2 text-xs overflow-x-auto mt-2">
                              {JSON.stringify(msg.raw, null, 2)}
                            </pre>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const composePrompt = (systemPrompt: string, userPrompt: string) => {
  const system = systemPrompt.trim();
  const user = userPrompt.trim();
  if (!system) return user;
  return `System: ${system}\nUser: ${user}`;
};

const generateId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getLatestAssistant = (messages: ChatMessage[]) =>
  [...messages].reverse().find((msg) => msg.role === "assistant") || null;

type NumberFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

function NumberField({ label, value, onChange, min, max, step }: NumberFieldProps) {
  return (
    <label className="space-y-1">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isNaN(next)) return;
          onChange(next);
        }}
        className="w-full border rounded-lg px-3 py-1.5 text-sm"
      />
    </label>
  );
}
