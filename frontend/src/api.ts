import type { Identity, Project, SessionInfo, TodoItem } from "./types";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:5000";

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as any).error || response.statusText);
  }
  return data as T;
}

type TodoQueryFilters = {
  state?: string;
  keyword?: string;
  assignedTo?: string;
  type?: string;
  page?: number;
  pageSize?: number;
  plannedFrom?: string;
  plannedTo?: string;
};

export const api = {
  login: (organization: string, pat: string) =>
    apiFetch<{ success: boolean; organization: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ organization, pat }),
    }),
  logout: () => apiFetch<{ success: boolean }>("/api/logout", { method: "POST" }),
  session: () => apiFetch<SessionInfo>("/api/session"),
  listProjects: () => apiFetch<{ projects: Project[] }>("/api/projects"),
  listTodos: (projectId: string, filters: TodoQueryFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.state) params.append("state", filters.state);
    if (filters.keyword) params.append("keyword", filters.keyword);
    if (filters.assignedTo) params.append("assignedTo", filters.assignedTo);
    if (filters.type) params.append("type", filters.type);
    if (filters.page) params.append("page", String(filters.page));
    if (filters.pageSize) params.append("pageSize", String(filters.pageSize));
    if (filters.plannedFrom) params.append("plannedFrom", filters.plannedFrom);
    if (filters.plannedTo) params.append("plannedTo", filters.plannedTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ todos: TodoItem[]; hasMore?: boolean }>(`/api/projects/${projectId}/todos${query}`);
  },
  listDescendants: (projectId: string, epicId: number) =>
    apiFetch<{ todos: TodoItem[] }>(`/api/projects/${projectId}/todos/descendants/${epicId}`),
  listTags: (projectId: string, search?: string) => {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ tags: string[] }>(`/api/projects/${projectId}/tags${query}`);
  },
  listAreas: (projectId: string, search?: string) => {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ areas: string[] }>(`/api/projects/${projectId}/areas${query}`);
  },
  listIterations: (projectId: string, search?: string) => {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ iterations: string[] }>(`/api/projects/${projectId}/iterations${query}`);
  },
  listAllTodos: (filters: TodoQueryFilters = {}) => {
    const params = new URLSearchParams();
    if (filters.state) params.append("state", filters.state);
    if (filters.keyword) params.append("keyword", filters.keyword);
    if (filters.assignedTo) params.append("assignedTo", filters.assignedTo);
    if (filters.type) params.append("type", filters.type);
    if (filters.page) params.append("page", String(filters.page));
    if (filters.pageSize) params.append("pageSize", String(filters.pageSize));
    if (filters.plannedFrom) params.append("plannedFrom", filters.plannedFrom);
    if (filters.plannedTo) params.append("plannedTo", filters.plannedTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    return apiFetch<{ todos: any[]; hasMore?: boolean }>(`/api/todos${query}`);
  },
  getTodo: (projectId: string, id: number) =>
    apiFetch<{ todo: TodoItem }>(`/api/projects/${projectId}/todos/${id}`),
  createTodo: (projectId: string, payload: any) =>
    apiFetch<{ todo: TodoItem }>(`/api/projects/${projectId}/todos`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateTodo: (projectId: string, id: number, payload: any) =>
    apiFetch<{ todo: TodoItem }>(`/api/projects/${projectId}/todos/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteTodo: (projectId: string, id: number) =>
    apiFetch<{ todo: TodoItem }>(`/api/projects/${projectId}/todos/${id}`, {
      method: "DELETE",
    }),
  listComments: (projectId: string, id: number) =>
    apiFetch<{ comments: any[] }>(`/api/projects/${projectId}/todos/${id}/comments`),
  addComment: (projectId: string, id: number, text: string) =>
    apiFetch<{ comment: any }>(`/api/projects/${projectId}/todos/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  searchIdentities: (query: string) => {
    const params = new URLSearchParams();
    params.append("q", query);
    return apiFetch<{ identities: Identity[] }>(`/api/identities?${params.toString()}`);
  },
  uploadAttachment: async (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`${API_BASE}/api/projects/${projectId}/attachments`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as any).error || response.statusText);
    }
    return data as { url: string };
  },
};
