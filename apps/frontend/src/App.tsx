import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Folder,
  FolderPlus,
  MessageSquare,
  Plus,
  Send,
} from "lucide-react";
import type { Message, OutgoingMessageType, Workspace } from "commons/types";
import { useSocket } from "./hooks/useSocket";
import "./index.css";

type ActiveSession = {
  workspaceId: string;
  sessionId: string;
};

export function App() {
  const { socket, loading } = useSocket();
  const [connected, setConnected] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [draft, setDraft] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [creatingSessionFor, setCreatingSessionFor] = useState<string | null>(null);
  const pendingSessionWorkspaceId = useRef<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const updateConnection = () => setConnected(socket.readyState === WebSocket.OPEN);
    updateConnection();
    socket.addEventListener("open", updateConnection);
    socket.addEventListener("close", updateConnection);
    socket.addEventListener("error", updateConnection);

    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as OutgoingMessageType;

        if (message.type === "init") {
          setWorkspaces(message.workspaces.map((workspace) => ({
            ...workspace,
            sessions: (workspace.sessions ?? []).map((session) => ({
              ...session,
              messages: session.messages ?? [],
            })),
          })));
          return;
        }

        if (message.type === "workspace-created") {
          setWorkspaces((current) => {
            if (current.some((workspace) => workspace.id === message.payload.id)) {
              return current;
            }
            return [...current, { ...message.payload, sessions: [] }];
          });
          setCreatingWorkspace(false);
          return;
        }

        if (message.type === "session-created") {
          const workspaceId = pendingSessionWorkspaceId.current;
          if (!workspaceId) return;
          pendingSessionWorkspaceId.current = null;
          setWorkspaces((current) =>
            current.map((workspace) =>
              workspace.id === workspaceId
                ? {
                    ...workspace,
                    sessions: [
                      ...workspace.sessions,
                      { id: message.payload.id, messages: [] },
                    ],
                  }
                : workspace,
            ),
          );
          setOpenWorkspaceId(workspaceId);
          setActiveSession({
            workspaceId,
            sessionId: message.payload.id,
          });
          setCreatingSessionFor(null);
        }

        if (message.type === "assistant-message") {
          const sessionId = activeSession?.sessionId;
          if (!sessionId) return;

          setWorkspaces((current) =>
            current.map((workspace) => ({
              ...workspace,
              sessions: workspace.sessions.map((session) =>
                session.id === sessionId
                  ? {
                      ...session,
                      messages: [
                        ...session.messages,
                        {
                          role: "assistant" as const,
                          payload: message.payload,
                        },
                      ],
                    }
                  : session,
              ),
            })),
          );
        }

        if (message.type === "tool-call") {
          setWorkspaces((current) =>
            current.map((workspace) => ({
              ...workspace,
              sessions: workspace.sessions.map((session) =>
                session.id === message.payload.sessionId
                  ? {
                      ...session,
                      messages: [
                        ...session.messages,
                        {
                          role: "tool" as const,
                          payload: {
                            name: message.payload.name,
                            input: message.payload.input,
                            toolUseId: message.payload.toolUseId,
                          },
                        },
                      ],
                    }
                  : session,
              ),
            })),
          );
        }

        if (message.type === "approval-request") {
          setWorkspaces((current) =>
            current.map((workspace) => ({
              ...workspace,
              sessions: workspace.sessions.map((session) =>
                session.id === message.payload.sessionId
                  ? {
                      ...session,
                      messages: [
                        ...session.messages,
                        {
                          role: "tool" as const,
                          payload: {
                            requestId: message.payload.requestId,
                            toolUseId: message.payload.toolUseId,
                            name: message.payload.toolName,
                            input: message.payload.input,
                            approvalStatus: "pending" as const,
                            title: message.payload.title,
                            description: message.payload.description,
                          },
                        },
                      ],
                    }
                  : session,
              ),
            })),
          );
        }

        if (message.type === "tool-approval-result") {
          setWorkspaces((current) =>
            current.map((workspace) => ({
              ...workspace,
              sessions: workspace.sessions.map((session) => ({
                ...session,
                messages: session.messages.map((entry) =>
                  entry.role === "tool" && entry.payload.requestId === message.payload.requestId
                    ? {
                        ...entry,
                        payload: {
                          ...entry.payload,
                          approvalStatus: message.payload.approved ? "approved" : "denied",
                        },
                      }
                    : entry,
                ),
              })),
            })),
          );
        }
      } catch (error) {
        console.error("Could not read server message", error);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => {
      socket.removeEventListener("open", updateConnection);
      socket.removeEventListener("close", updateConnection);
      socket.removeEventListener("error", updateConnection);
      socket.removeEventListener("message", handleMessage);
    };
  }, [socket, activeSession?.sessionId]);

  const handleCreateWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = workspacePath.trim();
    if (!path || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({ type: "create-workspace", payload: { path } }));
    setWorkspacePath("");
    setCreatingWorkspace(true);
  };

  const handleCreateSession = (workspaceId: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || creatingSessionFor) return;
    pendingSessionWorkspaceId.current = workspaceId;
    setCreatingSessionFor(workspaceId);
    socket.send(JSON.stringify({ type: "create-session", payload: { workspaceId } }));
  };

  const handleSendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (
      !text ||
      !activeSession ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "add-message",
        payload: { sessionId: activeSession.sessionId, message: text },
      }),
    );
    setWorkspaces((current) =>
      current.map((workspace) => ({
        ...workspace,
        sessions: workspace.sessions.map((session) =>
          session.id === activeSession.sessionId
            ? {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "user" as const,
                    payload: { message: text },
                  },
                ],
              }
            : session,
        ),
      })),
    );
    setDraft("");
  };

  const handleToolApproval = (requestId: string, approved: boolean) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "tool-approval-response",
        payload: { requestId, approved },
      }),
    );
  };

  const selectedWorkspace = workspaces.find(
    (workspace) => workspace.id === activeSession?.workspaceId,
  );
  const selectedSession = selectedWorkspace?.sessions.find(
    (session) => session.id === activeSession?.sessionId,
  );

  return (
    <main className="flex h-dvh min-h-120 flex-col bg-zinc-100 text-zinc-900">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-emerald-700 text-white">
            <MessageSquare size={17} />
          </div>
          <span className="text-sm font-semibold tracking-wide">Workbench</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className={`size-2 rounded-full ${connected ? "bg-emerald-500" : loading ? "animate-pulse bg-amber-400" : "bg-rose-500"}`}
          />
          {connected ? "Connected" : loading ? "Connecting" : "Offline"}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`${selectedSession ? "hidden sm:flex" : "flex"} w-full shrink-0 flex-col border-r border-zinc-200 bg-white sm:w-80`}>
          <div className="border-b border-zinc-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h1 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Workspaces
              </h1>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                {workspaces.length}
              </span>
            </div>
            <form onSubmit={handleCreateWorkspace} className="flex gap-2">
              <input
                aria-label="Workspace path"
                className="h-9 min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                placeholder="Enter workspace path"
                value={workspacePath}
                onChange={(event) => setWorkspacePath(event.target.value)}
              />
              <button
                aria-label="Create workspace"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!connected || !workspacePath.trim() || creatingWorkspace}
                title="Create workspace"
                type="submit"
              >
                <FolderPlus size={17} />
              </button>
            </form>
          </div>

          <nav aria-label="Workspace list" className="min-h-0 flex-1 overflow-y-auto p-2">
            {workspaces.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-zinc-400">
                {connected ? "No workspaces yet" : "Connect to load workspaces"}
              </p>
            ) : (
              <ul className="space-y-1">
                {workspaces.map((workspace) => {
                  const isOpen = openWorkspaceId === workspace.id;
                  return (
                    <li key={workspace.id}>
                      <div className="flex items-center gap-1">
                        <button
                          aria-expanded={isOpen}
                          className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition hover:bg-zinc-100"
                          onClick={() =>
                            setOpenWorkspaceId(isOpen ? null : workspace.id)
                          }
                          type="button"
                        >
                          <ChevronDown
                            className={`shrink-0 text-zinc-400 transition-transform ${isOpen ? "rotate-0" : "-rotate-90"}`}
                            size={16}
                          />
                          <Folder className="shrink-0 text-emerald-700" size={17} />
                          <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                          <span className="text-xs font-normal text-zinc-400">
                            {workspace.sessions.length}
                          </span>
                        </button>
                        <button
                          aria-label={`Create session in ${workspace.name}`}
                          className="flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-40"
                          disabled={!connected || creatingSessionFor !== null}
                          onClick={() => handleCreateSession(workspace.id)}
                          title="New session"
                          type="button"
                        >
                          <Plus size={17} />
                        </button>
                      </div>

                      {isOpen && (
                        <div className="ml-7 border-l border-zinc-200 py-1 pl-2">
                          {workspace.sessions.length === 0 ? (
                            <p className="px-2 py-2 text-xs text-zinc-400">
                              No sessions yet
                            </p>
                          ) : (
                            workspace.sessions.map((session, index) => {
                              const isSelected = activeSession?.sessionId === session.id;
                              return (
                                <button
                                  key={session.id}
                                  className={`flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition ${isSelected ? "bg-emerald-50 font-medium text-emerald-900" : "text-zinc-600 hover:bg-zinc-100"}`}
                                  onClick={() =>
                                    setActiveSession({
                                      workspaceId: workspace.id,
                                      sessionId: session.id,
                                    })
                                  }
                                  type="button"
                                >
                                  <MessageSquare size={15} />
                                  <span className="truncate">Session {index + 1}</span>
                                </button>
                              );
                            })
                          )}
                          <button
                            className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-40"
                            disabled={!connected || creatingSessionFor !== null}
                            onClick={() => handleCreateSession(workspace.id)}
                            type="button"
                          >
                            <Plus size={14} />
                            {creatingSessionFor === workspace.id ? "Creating..." : "New session"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
          <div className="border-t border-zinc-200 px-4 py-3 text-xs text-zinc-400">
            {loading ? "Connecting to backend..." : connected ? "Session service connected" : "Backend connection unavailable"}
          </div>
        </aside>

        <section className={`${selectedSession ? "flex" : "hidden sm:flex"} min-w-0 flex-1 flex-col`}>
          {selectedSession && selectedWorkspace ? (
            <>
              <header className="flex h-14 shrink-0 items-center border-b border-zinc-200 bg-white px-6">
                <button
                  aria-label="Back to workspaces"
                  className="mr-3 flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 sm:hidden"
                  onClick={() => setActiveSession(null)}
                  title="Back to workspaces"
                  type="button"
                >
                  <ArrowLeft size={17} />
                </button>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">Session</h2>
                  <p className="truncate text-xs text-zinc-500">
                    {selectedWorkspace.name} <span className="px-1">/</span>{selectedWorkspace.path}
                  </p>
                </div>
              </header>
              <div aria-live="polite" className="flex-1 overflow-y-auto px-5 py-6 md:px-10">
                {selectedSession.messages.length === 0 ? (
                  <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                    <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm ring-1 ring-zinc-200">
                      <MessageSquare size={20} />
                    </div>
                    <p className="text-sm font-medium text-zinc-700">A fresh conversation</p>
                    <p className="mt-1 text-xs text-zinc-400">Send a message to add it to this session.</p>
                  </div>
                ) : (
                  <div className="mx-auto flex max-w-3xl flex-col gap-4">
                    {selectedSession.messages.map((message: Message, index) => (
                      <MessageBubble
                        key={message.role === "user" ? message.id : `${selectedSession.id}-${index}`}
                        message={message}
                        onToolApproval={handleToolApproval}
                      />
                    ))}
                  </div>
                )}
              </div>
              <form
                className="border-t border-zinc-200 bg-white p-4 md:px-8 md:py-5"
                onSubmit={handleSendMessage}
              >
                <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-100">
                  <textarea
                    aria-label="Message"
                    className="max-h-36 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-zinc-400"
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Write a message..."
                    value={draft}
                  />
                  <button
                    aria-label="Send message"
                    className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!connected || !draft.trim()}
                    title="Send message"
                    type="submit"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-white text-zinc-400 shadow-sm ring-1 ring-zinc-200">
                <Folder size={21} />
              </div>
              <h2 className="text-sm font-semibold text-zinc-700">Choose a session</h2>
              <p className="mt-1 max-w-xs text-sm text-zinc-500">
                Open a workspace and select a session, or create a new one to start chatting.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MessageBubble({
  message,
  onToolApproval,
}: {
  message: Message;
  onToolApproval: (requestId: string, approved: boolean) => void;
}) {
  if (message.role === "tool") {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[min(85%,42rem)] overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100">
          <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-200">{message.payload.name}</span>
              <span>{message.payload.approvalStatus === "pending" ? "Approval required" : "Tool call"}</span>
            </div>
            {message.payload.approvalStatus && message.payload.approvalStatus !== "pending" && (
              <span className={`text-xs ${message.payload.approvalStatus === "approved" ? "text-emerald-400" : "text-rose-400"}`}>
                {message.payload.approvalStatus === "approved" ? "Approved" : "Denied"}
              </span>
            )}
          </div>
          {message.payload.title && (
            <p className="px-3 pt-3 text-sm text-zinc-300">{message.payload.title}</p>
          )}
          <div className="px-3 py-3">
            <p className="mb-1 text-[10px] font-semibold uppercase text-zinc-500">Input</p>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word rounded bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200">
            {JSON.stringify(message.payload.input, null, 2)}
            </pre>
          </div>
          {message.payload.description && (
            <p className="px-3 pb-3 text-xs text-zinc-400">{message.payload.description}</p>
          )}
          {message.payload.approvalStatus === "pending" && message.payload.requestId && (
            <div className="flex justify-end gap-2 border-t border-zinc-700 px-3 py-2">
              <button
                className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                onClick={() => onToolApproval(message.payload.requestId!, false)}
                type="button"
              >
                Reject
              </button>
              <button
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                onClick={() => onToolApproval(message.payload.requestId!, true)}
                type="button"
              >
                Approve edit
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const content =
    message.role === "user"
      ? message.payload.message
      : typeof message.payload?.message === "string"
        ? message.payload.message
        : typeof message.payload === "string"
          ? message.payload
          : JSON.stringify(message.payload);

  return (
    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[min(85%,42rem)] whitespace-pre-wrap wrap-break-word rounded-lg px-4 py-3 text-sm leading-6 ${message.role === "user" ? "bg-emerald-800 text-white" : "border border-zinc-200 bg-white text-zinc-800"}`}
      >
        {content}
      </div>
    </div>
  );
}

export default App;