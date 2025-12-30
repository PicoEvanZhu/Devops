import { BarChartOutlined, BulbOutlined, ClearOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, LeftOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UnorderedListOutlined, UserAddOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Card, Checkbox, Col, DatePicker, Drawer, Dropdown, Empty, Form, Input, InputNumber, Row, Select, Segmented, Space, Table, Tag, Tabs, Typography, message } from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { api, API_BASE } from "../api";
import { RichTextEditor } from "../components/RichTextEditor";
import type { RichTextEditorHandle } from "../components/RichTextEditor";
import type { Identity } from "../types";
import { useI18n } from "../i18n";

type FiltersState = {
  state?: string;
  keyword?: string;
  assignedTo?: string;
  type?: string;
  project?: string;
  page?: number;
  pageSize?: number;
  closedFrom?: string;
  closedTo?: string;
  plannedFrom?: string;
  plannedTo?: string;
};

type TabKey = "all" | "no-start" | "on-going" | "completed";

type LatestCommentPreview = {
  preview: string;
  createdBy?: string;
  createdDate?: string;
};

const typeColors: Record<string, string> = {
  Epic: "magenta",
  Feature: "gold",
  "User Story": "purple",
  "Product Backlog Item": "green",
  Task: "blue",
  Bug: "red",
};

const priorityColors: Record<number, string> = {
  1: "red",
  2: "orange",
  3: "gold",
  4: "green",
};

const stateColors: Record<string, string> = {
  new: "blue",
  active: "gold",
  doing: "gold",
  resolved: "green",
  closed: "green",
  removed: "default",
};

const ALL_WORK_ITEM_TYPES = ["Epic", "Feature", "User Story", "Product Backlog Item", "Task", "Bug", "Issue"];
const DEFAULT_WORK_ITEM_TYPES = ALL_WORK_ITEM_TYPES.filter((t) => t !== "Epic");
const NO_EPIC_SENTINEL = "__NO_EPIC__";

const projectBadgePalette = [
  { background: "#e6f4ff", color: "#0958d9" },
  { background: "#f9f0ff", color: "#722ed1" },
  { background: "#fef0f6", color: "#c41d7f" },
  { background: "#fff7e6", color: "#d46b08" },
  { background: "#f6ffed", color: "#389e0d" },
  { background: "#e6fffb", color: "#08979c" },
  { background: "#fff1f0", color: "#d4380d" },
];

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0; // convert to 32bit int
  }
  return Math.abs(hash);
};

const normalizeProjectName = (name?: string) => {
  if (!name) return undefined;
  const trimmed = name.trim();
  if (/^pico\s+services$/i.test(trimmed)) return "Helpdesk";
  if (/^ies-?x$/i.test(trimmed)) return "Concierge";
  return trimmed;
};

const normalizeAlignmentItem = (item: any, projectId?: string) => ({
  ...item,
  projectId: item.projectId || projectId,
  projectName: item.projectName || item.project,
});

const stripHtml = (value?: string): string => {
  if (!value) return "";
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

const projectBadgeStyle = (projectName?: string) => {
  const normalized = normalizeProjectName(projectName);
  if (!normalized) {
    return { background: "#f5f5f5", color: "#595959" };
  }
  const index = hashString(normalized) % projectBadgePalette.length;
  return projectBadgePalette[index];
};

const parseTabKey = (value?: string | null): TabKey | null => {
  if (!value) return null;
  if (value === "all" || value === "no-start" || value === "on-going" || value === "completed") {
    return value;
  }
  return null;
};

const getProjectSortKey = (item: any) => normalizeProjectName(item?.projectName || item?.project || item?.projectId) || "";
const stringSorter = (getter: (item: any) => string) => (a: any, b: any) => getter(a).localeCompare(getter(b));

const proxyAzureResourceUrl = (url?: string) => {
  if (!url) return undefined;
  if (/dev\.azure\.com/i.test(url)) {
    return `${API_BASE}/api/attachments/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
};

const rewriteAzureAttachmentHtml = (html: string): string => {
  if (!html) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const images = doc.querySelectorAll("img");
    images.forEach((img) => {
      const src = img.getAttribute("src");
      if (!src) return;
      const normalized = src.trim();
      if (/dev\.azure\.com/i.test(normalized) && normalized.includes("_apis/wit/attachments")) {
        const proxied = `${API_BASE}/api/attachments/proxy?url=${encodeURIComponent(normalized)}`;
        img.setAttribute("src", proxied);
      }
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
};

const summarizeCommentText = (html: string, limit = 140): string => {
  if (!html) return "";
  let text = stripHtml(html);
  if (/<img\b/i.test(html)) {
    text = text ? `${text} [Image]` : "[Image]";
  }
  if (!text) {
    text = "Rich content";
  }
  if (text.length > limit) {
    return `${text.slice(0, limit)}…`;
  }
  return text;
};

const hasRichContent = (html: string): boolean => {
  if (!html) return false;
  const text = html.replace(/<[^>]*>/g, "").trim();
  if (text.length > 0) return true;
  return /<(img|video|audio|iframe|embed|object)\b/i.test(html);
};


const serializeDateValue = (value: any): string | null | undefined => {
  if (value === null) return null;
  if (!value) return undefined;
  const parsed = dayjs.isDayjs(value) ? value : dayjs(value);
  return parsed.isValid() ? parsed.toISOString() : undefined;
};

function getCurrentWeekRange(): { from: string; to: string } {
  const now = new Date();
  const day = now.getDay(); // Sunday = 0, Monday = 1, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { from: monday.toISOString(), to: sunday.toISOString() };
}

function getRelativeWeekRange(offset: number): { from: string; to: string } {
  const base = new Date();
  base.setDate(base.getDate() + offset * 7);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(base);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(base.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

function getCurrentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: first.toISOString(), to: last.toISOString() };
}

function getDayRange(offsetDays = 0): { from: string; to: string } {
  const start = new Date();
  start.setDate(start.getDate() + offsetDays);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

type AllTodosPageProps = {
  forcedProjectId?: string;
  hideProjectSelector?: boolean;
};

export function AllTodosPage({ forcedProjectId, hideProjectSelector = false }: AllTodosPageProps = {}) {
  const FILTER_STORAGE_KEY = "allTodosFilters";
  const OWNER_FILTER_STORAGE_KEY = "dashboardOwnerFilter";
  const { t } = useI18n();
  const location = useLocation();
  const [todos, setTodos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const buildDefaultFilters = useCallback((): FiltersState => {
    const base: FiltersState = { page: 1, pageSize: 100, type: NO_EPIC_SENTINEL };
    return forcedProjectId ? { ...base, project: forcedProjectId } : base;
  }, [forcedProjectId]);
  const [filters, setFilters] = useState<FiltersState>(() => {
    if (typeof window !== "undefined") {
      try {
        const owner = window.localStorage.getItem(OWNER_FILTER_STORAGE_KEY);
        const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as Partial<FiltersState>;
          const type = stored.type || NO_EPIC_SENTINEL;
          return {
            ...buildDefaultFilters(),
            ...stored,
            assignedTo: owner || stored.assignedTo,
            type,
            page: 1,
            pageSize: 100,
          };
        }
        if (owner) {
          return {
            ...buildDefaultFilters(),
            assignedTo: owner,
          };
        }
      } catch {
        // ignore parse errors
      }
    }
    return buildDefaultFilters();
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 100, total: 0 });
  const [viewMode, setViewMode] = useState<"table" | "gantt" | "board">("table");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [keywordInput, setKeywordInput] = useState(filters.keyword || "");
  const [assignedInput, setAssignedInput] = useState(filters.assignedTo || "");
  const [projects, setProjects] = useState<{ label: string; value: string }[]>([]);
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);
  const [areaOptions, setAreaOptions] = useState<{ label: string; value: string }[]>([]);
  const [iterationOptions, setIterationOptions] = useState<{ label: string; value: string }[]>([]);
  const [parentOptions, setParentOptions] = useState<{ label: string; value: number }[]>([]);
  const [form] = Form.useForm();
  const [tabKey, setTabKey] = useState<TabKey>(() => {
    const params = new URLSearchParams(location.search);
    return parseTabKey(params.get("tab")) || "on-going";
  });
  const [comments, setComments] = useState<any[]>([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [organization, setOrganization] = useState("");
  const [currentUser, setCurrentUser] = useState("");
  const commentEditorRef = useRef<RichTextEditorHandle>(null);
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionOptions, setMentionOptions] = useState<{ label: string; value: string; identity: Identity }[]>([]);
  const [mentionSearchValue, setMentionSearchValue] = useState("");
  const [mentionLoading, setMentionLoading] = useState(false);
  const [latestCommentMap, setLatestCommentMap] = useState<Record<string, LatestCommentPreview>>({});
  const latestCommentRequestRef = useRef(0);
  const tagSearchTimeout = useRef<number | null>(null);
  const areaSearchTimeout = useRef<number | null>(null);
  const iterationSearchTimeout = useRef<number | null>(null);
  const parentSearchTimeout = useRef<number | null>(null);
  const mentionSearchTimeout = useRef<number | null>(null);
  const [alignmentEpic, setAlignmentEpic] = useState<any | null>(null);
  const [alignmentItems, setAlignmentItems] = useState<any[]>([]);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [hideNotStarted, setHideNotStarted] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [alignmentZoom, setAlignmentZoom] = useState(1);
  const alignmentViewportRef = useRef<HTMLDivElement | null>(null);
  const alignmentRequestRef = useRef(0);
  const alignmentInitRef = useRef(false);
  const alignmentAutoOpenRef = useRef(false);
  const tabInitRef = useRef(false);
  const todoOpenRef = useRef<string | null>(null);
  const ganttScrollRef = useRef<HTMLDivElement | null>(null);
  const ganttRangeRef = useRef<string | null>(null);
  const [confettiSeed, setConfettiSeed] = useState(0);
  const [confettiActive, setConfettiActive] = useState(false);
  const confettiTimerRef = useRef<number | null>(null);
  const ganttDragRef = useRef<{
    active: boolean;
    startX: number;
    scrollLeft: number;
  }>({
    active: false,
    startX: 0,
    scrollLeft: 0,
  });
  const alignmentDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });
  const tabFromQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return parseTabKey(params.get("tab"));
  }, [location.search]);

  useEffect(() => {
    return () => {
      if (confettiTimerRef.current) {
        window.clearTimeout(confettiTimerRef.current);
      }
    };
  }, []);

  const triggerConfetti = useCallback(() => {
    if (confettiTimerRef.current) {
      window.clearTimeout(confettiTimerRef.current);
    }
    setConfettiSeed(Date.now());
    setConfettiActive(true);
    confettiTimerRef.current = window.setTimeout(() => {
      setConfettiActive(false);
    }, 1600) as unknown as number;
  }, []);

  const debounce = (ref: React.MutableRefObject<number | null>, fn: () => void, delay = 400) => {
    if (ref.current) {
      window.clearTimeout(ref.current);
    }
    ref.current = window.setTimeout(fn, delay) as unknown as number;
  };

  useEffect(() => {
    if (tabKey !== "all" && viewMode === "board") {
      setViewMode("table");
    }
  }, [tabKey, viewMode]);

  useEffect(() => {
    return () => {
      [
        tagSearchTimeout,
        areaSearchTimeout,
        iterationSearchTimeout,
        parentSearchTimeout,
        mentionSearchTimeout,
      ].forEach((ref) => {
        if (ref.current) {
          window.clearTimeout(ref.current);
        }
      });
    };
  }, []);
  const advanceState = (state?: string) => {
    const normalized = (state || "").toLowerCase();
    if (normalized === "new") return "Active";
    if (normalized === "active" || normalized === "validate") return "Closed";
    return "Closed";
  };

  const isNotStarted = (state?: string) => {
    const normalized = (state || "").toLowerCase();
    return normalized === "new";
  };

  const isCompleted = (state?: string) => {
    const normalized = (state || "").toLowerCase();
    return normalized === "closed" || normalized === "resolved";
  };

  const isOverdue = (item: any) => {
    if (!item?.targetDate) return false;
    if (isCompleted(item.state)) return false;
    return dayjs(item.targetDate).endOf("day").isBefore(dayjs().startOf("day"));
  };

  const openAlignmentView = async (epic: any) => {
    setAlignmentEpic(epic);
    setAlignmentLoading(true);
    setHideCompleted(false);
    setHideNotStarted(false);
    const requestId = alignmentRequestRef.current + 1;
    alignmentRequestRef.current = requestId;
      const loadByPaging = async (projectId: string, requestId: number) => {
        let page = 1;
        let hasMore = true;
        while (hasMore) {
          const res = await api.listTodos(projectId, { page, pageSize: 200 });
          if (alignmentRequestRef.current !== requestId) return;
          const batch = (res.todos || []).map((item: any) => ({
            ...item,
            projectId: item.projectId || projectId,
            projectName: item.projectName || item.project,
          }));
          setAlignmentItems((prev) => {
            const map = new Map<number, any>();
            prev.forEach((item) => {
              if (typeof item?.id === "number") {
              map.set(item.id, item);
            }
          });
          batch.forEach((item: any) => {
            if (typeof item?.id === "number") {
              map.set(item.id, item);
            }
          });
          return Array.from(map.values());
        });
        if (page === 1) {
          setAlignmentLoading(false);
        }
        hasMore = Boolean(res.hasMore);
        page += 1;
      }
    };

    try {
      const projectId = epic.projectId;
      if (!projectId || !epic.id) {
        setAlignmentItems([]);
        return;
      }
      setAlignmentItems([]);
      const res = await api.listDescendants(projectId, epic.id);
      if (alignmentRequestRef.current !== requestId) return;
      const enriched = (res.todos || []).map((item: any) => ({
        ...item,
        projectId: item.projectId || projectId,
        projectName: item.projectName || item.project,
      }));
      setAlignmentItems(enriched);
    } catch (err: any) {
      const projectId = epic.projectId;
      if (projectId) {
        await loadByPaging(projectId, requestId);
      } else {
        message.error(err.message || "Failed to load alignment view");
      }
    } finally {
      if (alignmentRequestRef.current === requestId) {
        setAlignmentLoading(false);
      }
    }
  };

  const mergeAlignmentItems = useCallback((items: any[], projectId?: string) => {
    if (!items.length) return;
    setAlignmentItems((prev) => {
      const map = new Map<number, any>();
      prev.forEach((item) => {
        if (typeof item?.id === "number") {
          map.set(item.id, item);
        }
      });
      items.forEach((item) => {
        if (typeof item?.id === "number") {
          map.set(item.id, normalizeAlignmentItem(item, projectId));
        }
      });
      return Array.from(map.values());
    });
  }, []);

  const refreshAlignmentNodes = useCallback(
    async ({
      projectId,
      itemId,
      parentId,
      updatedItem,
    }: {
      projectId: string;
      itemId?: number;
      parentId?: number;
      updatedItem?: any;
    }) => {
      if (!alignmentEpic || !projectId) return;
      const items: any[] = [];
      if (updatedItem) {
        items.push(updatedItem);
      } else if (itemId) {
        try {
          const res = await api.getTodo(projectId, itemId);
          if (res?.todo) items.push(res.todo);
        } catch (err) {
          // ignore refresh failure for a single node
        }
      }
      if (parentId) {
        try {
          const res = await api.getTodo(projectId, parentId);
          if (res?.todo) items.push(res.todo);
        } catch (err) {
          // ignore parent refresh failure
        }
      }
      if (items.length) {
        mergeAlignmentItems(items, projectId);
        items.forEach((item) => {
          if (alignmentEpic?.id && item?.id === alignmentEpic.id) {
            setAlignmentEpic(normalizeAlignmentItem(item, projectId));
          }
        });
      }
    },
    [alignmentEpic, mergeAlignmentItems]
  );

  const handleAlignmentPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = alignmentViewportRef.current;
    if (!viewport) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".alignment-node-card")) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    alignmentDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    alignmentDragRef.current.active = true;
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleAlignmentPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = alignmentViewportRef.current;
    if (!viewport || !alignmentDragRef.current.active) return;
    const deltaX = event.clientX - alignmentDragRef.current.startX;
    const deltaY = event.clientY - alignmentDragRef.current.startY;
    viewport.scrollLeft = alignmentDragRef.current.scrollLeft - deltaX;
    viewport.scrollTop = alignmentDragRef.current.scrollTop - deltaY;
    event.preventDefault();
  };

  const handleAlignmentPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = alignmentViewportRef.current;
    if (!viewport) return;
    alignmentDragRef.current.active = false;
    viewport.releasePointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleGanttPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = ganttScrollRef.current;
    if (!viewport) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".gantt-label")) {
      return;
    }
    if (!target?.closest(".gantt-bar-wrapper") && !target?.closest(".gantt-scale-track")) {
      return;
    }
    if (target?.closest(".gantt-bar")) {
      return;
    }
    ganttDragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: viewport.scrollLeft,
    };
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleGanttPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = ganttScrollRef.current;
    if (!viewport || !ganttDragRef.current.active) return;
    const deltaX = event.clientX - ganttDragRef.current.startX;
    viewport.scrollLeft = ganttDragRef.current.scrollLeft - deltaX;
    event.preventDefault();
  };

  const handleGanttPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = ganttScrollRef.current;
    if (!viewport) return;
    ganttDragRef.current.active = false;
    viewport.releasePointerCapture(event.pointerId);
    event.preventDefault();
  };

  const loadTodos = async (nextFilters = filters, tabOverride?: string) => {
    const effectiveFilters = enforceProjectFilter(nextFilters);
    const currentTab = tabOverride || tabKey;
    let stateFilter = effectiveFilters.state;
    let allowedStates: string[] = [];
    if (currentTab === "no-start") {
      stateFilter = "New";
      allowedStates = ["new"];
    } else if (currentTab === "on-going") {
      stateFilter = "Active,Validate";
      allowedStates = ["active", "validate"];
    } else if (currentTab === "completed") {
      stateFilter = "Closed,Resolved";
      allowedStates = ["closed", "resolved"];
    }
    const { plannedFrom, plannedTo, ...apiFilters } = effectiveFilters;
    setLoading(true);
    try {
        const res = await api.listAllTodos({ ...apiFilters, state: stateFilter });
      const raw = res.todos || [];
      const filteredByState =
        allowedStates.length === 0
          ? raw
          : raw.filter((t) => {
              const s = (t.state || "").toString().trim().toLowerCase();
              return allowedStates.includes(s);
            });
      const projectFilter = effectiveFilters.project;
      let filtered =
        projectFilter && projectFilter.length > 0
          ? filteredByState.filter((t) => String(t.projectId || "").toString() === projectFilter)
          : filteredByState;

      if (currentTab === "completed" && (nextFilters.closedFrom || nextFilters.closedTo)) {
        const from = nextFilters.closedFrom ? new Date(nextFilters.closedFrom) : undefined;
        const to = nextFilters.closedTo ? new Date(nextFilters.closedTo) : undefined;
        filtered = filtered.filter((t) => {
          const raw = (t as any).closedDate || (t as any).changedDate || (t as any).createdDate;
          if (!raw) return false;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
      }
      if (plannedFrom || plannedTo) {
        const from = plannedFrom ? new Date(plannedFrom) : undefined;
        const to = plannedTo ? new Date(plannedTo) : undefined;
        filtered = filtered.filter((t) => {
          const startRaw = (t as any).plannedStartDate;
          if (!startRaw) return false;
          const startDate = new Date(startRaw);
          if (Number.isNaN(startDate.getTime())) return false;
          const finishRaw = (t as any).targetDate || startRaw;
          const finishDate = new Date(finishRaw);
          if (Number.isNaN(finishDate.getTime())) return false;
          if (from && finishDate < from) return false;
          if (to && startDate > to) return false;
          return true;
        });
      }

      const sorted = [...filtered];
      if (currentTab === "no-start") {
        sorted.sort((a, b) => {
          const dateA = new Date(a.changedDate || a.createdDate || 0).getTime();
          const dateB = new Date(b.changedDate || b.createdDate || 0).getTime();
          return dateB - dateA;
        });
      } else {
        sorted.sort((a, b) => {
          const assignedA = ((a.assignedTo || "").trim().toLowerCase()) || "\uffff";
          const assignedB = ((b.assignedTo || "").trim().toLowerCase()) || "\uffff";
          if (assignedA !== assignedB) {
            return assignedA.localeCompare(assignedB);
          }
          const keyA = getProjectSortKey(a).toLowerCase();
          const keyB = getProjectSortKey(b).toLowerCase();
          if (keyA !== keyB) {
            return keyA.localeCompare(keyB);
          }
          const parentA = a.parentId ?? Number.MAX_SAFE_INTEGER;
          const parentB = b.parentId ?? Number.MAX_SAFE_INTEGER;
          if (parentA !== parentB) {
            return parentA - parentB;
          }
          return (a.id || 0) - (b.id || 0);
        });
      }
      setTodos(sorted);
      const page = effectiveFilters.page || 1;
      const pageSize = effectiveFilters.pageSize || 20;
      const hasMore = res.hasMore;
      const total = hasMore ? page * pageSize + 1 : (page - 1) * pageSize + (sorted.length || 0);
      setPagination({ current: page, pageSize, total });
    } catch (err: any) {
      message.error(err.message || "Failed to load to-dos");
    } finally {
      setLoading(false);
    }
  };

  const alignmentMode = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("alignment") === "1";
  }, [location.search]);

  useEffect(() => {
    if (!alignmentMode || alignmentInitRef.current) return;
    alignmentInitRef.current = true;
    setTabKey("all");
    const next = { ...filters, type: "Epic", state: undefined, page: 1 };
    const enforced = applyFilters(next);
    persistFilters(enforced);
    loadTodos(enforced, "all");
  }, [alignmentMode]);

  useEffect(() => {
    if (!alignmentMode || alignmentAutoOpenRef.current || alignmentEpic) return;
    if (!forcedProjectId) return;
    alignmentAutoOpenRef.current = true;
    api
      .listTodos(forcedProjectId, { page: 1, pageSize: 1, type: "Epic" })
      .then((res) => {
        const firstEpic = (res.todos || [])[0];
        if (firstEpic) {
          openAlignmentView(firstEpic);
        }
      })
      .catch((err: any) => {
        message.error(err.message || "Failed to load Epic");
      });
  }, [alignmentMode, alignmentEpic, forcedProjectId]);

  useEffect(() => {
    // 初次加载时根据当前 tabKey 应用状态筛选；
    // 这里默认 tabKey 为 "on-going"，所以默认查看 On-Going。
    loadTodos(filters, tabKey);
    api
      .session()
      .then((res) => {
        setOrganization(res.organization || "");
        const name = res.user?.displayName || res.user?.email || "";
        setCurrentUser(name);
      })
      .catch(() => void 0);
    api
      .listProjects()
      .then((res) => {
        const opts = (res.projects || []).map((p) => ({ label: p.name, value: p.id }));
        setProjects(opts);
      })
      .catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistFilters = (next: FiltersState) => {
    if (typeof window === "undefined" || forcedProjectId) return;
    try {
      const { page, pageSize, ...rest } = next;
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(rest));
    } catch {
      // ignore quota errors
    }
  };

  const enforceProjectFilter = (input: FiltersState): FiltersState =>
    forcedProjectId ? { ...input, project: forcedProjectId } : input;

  const applyFilters = (next: FiltersState) => {
    const enforced = enforceProjectFilter(next);
    setFilters(enforced);
    return enforced;
  };

  useEffect(() => {
    if (forcedProjectId) {
      form.setFieldsValue({ projectId: forcedProjectId });
    }
  }, [forcedProjectId, form]);

  useEffect(() => {
    if (!drawerOpen || editing) return;
    if (!currentUser) return;
    const currentAssigned = form.getFieldValue("assignedTo");
    if (!currentAssigned) {
      form.setFieldsValue({ assignedTo: currentUser });
    }
  }, [currentUser, drawerOpen, editing, form]);

  useEffect(() => {
    if (forcedProjectId && filters.project !== forcedProjectId) {
      setFilters((prev) => ({ ...prev, project: forcedProjectId }));
    }
  }, [forcedProjectId, filters.project]);

  useEffect(() => {
    if ((filters.keyword || "") !== keywordInput) {
      setKeywordInput(filters.keyword || "");
    }
    if ((filters.assignedTo || "") !== assignedInput) {
      setAssignedInput(filters.assignedTo || "");
    }
  }, [filters.keyword, filters.assignedTo]);

  const buildKeywordFilters = (raw: string | undefined, base: FiltersState): FiltersState => {
    const text = raw?.trim();
    if (!text) {
      return { ...base, keyword: undefined, page: 1 };
    }

    const typeMap: Record<string, string> = {
      epic: "Epic",
      feature: "Feature",
      us: "User Story",
      pbi: "Product Backlog Item",
      task: "Task",
      bug: "Bug",
    };

    const match = text.match(/^([a-zA-Z]+)-(.*)$/);
    if (match) {
      const prefix = match[1].toLowerCase();
      const rest = match[2].trim();
      const mappedType = typeMap[prefix];
      return {
        ...base,
        keyword: rest || undefined,
        type: mappedType || base.type,
        page: 1,
      };
    }

    return { ...base, keyword: text, page: 1 };
  };

  const applySearchFilters = useCallback(() => {
    const nextFromKeyword = buildKeywordFilters(keywordInput || undefined, filters);
    const next = { ...nextFromKeyword, assignedTo: assignedInput || undefined, page: 1 };
    const enforced = applyFilters(next);
    persistFilters(enforced);
    if (typeof window !== "undefined") {
      if (assignedInput) {
        window.localStorage.setItem(OWNER_FILTER_STORAGE_KEY, assignedInput);
      } else {
        window.localStorage.removeItem(OWNER_FILTER_STORAGE_KEY);
      }
    }
    loadTodos(enforced);
  }, [assignedInput, buildKeywordFilters, filters, keywordInput]);

  const applyClosedRangeShortcut = (range: { from: string; to: string }) => {
    const next = {
      ...filters,
      closedFrom: range.from,
      closedTo: range.to,
      page: 1,
    };
    const enforced = applyFilters(next);
    persistFilters(enforced);
    loadTodos(enforced, "completed");
  };

  const applyPlannedRangeShortcut = (range: { from: string; to: string }) => {
    const next = {
      ...filters,
      plannedFrom: range.from,
      plannedTo: range.to,
      page: 1,
    };
    const enforced = applyFilters(next);
    persistFilters(enforced);
    loadTodos(enforced, "on-going");
  };

  const clearFilters = () => {
    const next = buildDefaultFilters();
    if (typeof window !== "undefined" && !forcedProjectId) {
      try {
        window.localStorage.removeItem(FILTER_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    setFilters(next);
    setPagination((prev) => ({ ...prev, current: 1 }));
    loadTodos(next, tabKey);
  };

  const hasActiveFilters = useMemo(() => {
    const defaults = buildDefaultFilters();
    return (
      !!filters.keyword ||
      !!filters.assignedTo ||
      !!filters.state ||
      !!filters.closedFrom ||
      !!filters.closedTo ||
      !!filters.plannedFrom ||
      !!filters.plannedTo ||
      (!!filters.project && filters.project !== defaults.project) ||
      (!!filters.type && filters.type !== defaults.type)
    );
  }, [filters, buildDefaultFilters]);

  const ganttRows = useMemo(() => {
    return todos
      .filter((item) => item.plannedStartDate)
      .map((item) => {
        const start = dayjs(item.plannedStartDate);
        const rawEnd = item.targetDate ? dayjs(item.targetDate) : start.add(1, "day");
        const end = rawEnd.isAfter(start) ? rawEnd : start.add(1, "day");
        return { item, start, end };
      });
  }, [todos]);

  const ganttMeta = useMemo(() => {
    if (!ganttRows.length) return null;
    const todayStart = dayjs().startOf("day");
    let minStart = ganttRows[0].start.startOf("day");
    let maxEnd = ganttRows[0].end.endOf("day");
    ganttRows.forEach(({ start, end }) => {
      if (start.isBefore(minStart)) {
        minStart = start.startOf("day");
      }
      if (end.isAfter(maxEnd)) {
        maxEnd = end.endOf("day");
      }
    });
    if (maxEnd.isBefore(minStart)) {
      maxEnd = minStart.add(1, "day");
    }
    const totalDays = Math.max(maxEnd.diff(minStart, "day"), 1);
    const totalSlots = totalDays + 1;
    const dayWidth = 60;
    const labelWidth = 300;
    const barWidth = totalSlots * dayWidth;
    const timelineWidth = labelWidth + barWidth;
    const weekLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const ticks = Array.from({ length: totalSlots }, (_, idx) => {
      const current = minStart.add(idx, "day");
      const weekday = weekLabels[current.day()];
      const label = weekday === "周一" ? `${current.format("MM-DD")} ${weekday}` : weekday;
      return { offset: idx, label };
    });
    const todayOffset = Math.max(todayStart.diff(minStart, "day"), 0) * dayWidth;
    return {
      minStart,
      maxEnd,
      totalDays,
      totalSlots,
      dayWidth,
      labelWidth,
      barWidth,
      timelineWidth,
      ticks,
      todayOffset,
      rangeKey: `${minStart.toISOString()}_${maxEnd.toISOString()}`,
    };
  }, [ganttRows]);

  useEffect(() => {
    if (!ganttMeta || viewMode !== "gantt") return;
    if (ganttRangeRef.current === ganttMeta.rangeKey) return;
    ganttRangeRef.current = ganttMeta.rangeKey;
    const viewport = ganttScrollRef.current;
    if (!viewport) return;
    viewport.scrollLeft = ganttMeta.todayOffset;
  }, [ganttMeta, viewMode]);

  const renderGanttView = () => {
    if (!ganttRows.length || !ganttMeta) {
      return <Empty description="暂无可展示的计划数据" />;
    }
    const { minStart, totalDays, dayWidth, labelWidth, barWidth, timelineWidth, ticks } = ganttMeta;
    const todayStart = dayjs().startOf("day");

    return (
      <div className="gantt-container">
        <div className="gantt-toolbar">
          <div className="gantt-toolbar-spacer" />
          <Button
            size="small"
            onClick={() => {
              const viewport = ganttScrollRef.current;
              if (viewport && ganttMeta) {
                viewport.scrollLeft = ganttMeta.todayOffset;
              }
            }}
          >
            {t("filters.today", "Today")}
          </Button>
        </div>
        <div
          className="gantt-scroll"
          ref={ganttScrollRef}
          onPointerDown={handleGanttPointerDown}
          onPointerMove={handleGanttPointerMove}
          onPointerUp={handleGanttPointerUp}
          onPointerLeave={handleGanttPointerUp}
        >
          <div className="gantt-timeline" style={{ width: timelineWidth }}>
            <div className="gantt-scale">
              <div className="gantt-scale-spacer" style={{ width: labelWidth }} />
              <div className="gantt-scale-track" style={{ width: barWidth }}>
                {ticks.map((tick, idx) => (
                  <div className="gantt-scale-tick" style={{ left: tick.offset * dayWidth }} key={`${tick.label}-${idx}`}>
                    <span>{tick.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="gantt-rows">
              {ganttRows.map(({ item, start, end }) => {
                const adjustedStart = start.isBefore(minStart) ? minStart : start.startOf("day");
                const normalizedEnd = end.endOf("day");
                const leftPx = Math.max(0, adjustedStart.diff(minStart, "day")) * dayWidth;
                const spanDays = Math.max(normalizedEnd.diff(adjustedStart, "day"), 0) + 1;
                const widthPx = Math.max(spanDays * dayWidth, 6);
                const isDone = isCompleted(item.state);
                const isOverdue =
                  !isDone &&
                  item.targetDate &&
                  dayjs(item.targetDate).endOf("day").isBefore(todayStart);
                const isNotStartedByDate = !isDone && todayStart.isBefore(start.startOf("day"));
                const isInProgress =
                  !isDone &&
                  !isNotStartedByDate &&
                  !isOverdue &&
                  item.targetDate &&
                  todayStart.isAfter(start.startOf("day")) &&
                  todayStart.isBefore(end.endOf("day"));
                const avatarSrc = proxyAzureResourceUrl(item.assignedToAvatar);
                const initials = (item.assignedTo || "?")
                  .split(" ")
                  .map((part: string) => part.charAt(0).toUpperCase())
                  .join("")
                  .slice(0, 2);
                return (
                  <div className="gantt-row" key={`${item.projectId}-${item.id}`} style={{ width: timelineWidth }}>
                    <div
                      className="gantt-label gantt-label-action"
                      style={{ width: labelWidth }}
                      role="button"
                      tabIndex={0}
                      onClick={() => openEditForm(item)}
                      onKeyDown={(evt) => {
                        if (evt.key === "Enter" || evt.key === " ") {
                          evt.preventDefault();
                          openEditForm(item);
                        }
                      }}
                    >
                      <div className="gantt-avatar">
                        {avatarSrc ? <img src={avatarSrc} alt={item.assignedTo || "User"} /> : initials || "-"}
                      </div>
                    <div className="gantt-label-body">
                      <div className="gantt-label-title">
                        <span className="gantt-project-pill" style={projectBadgeStyle(item.projectName || item.projectId)}>
                          {normalizeProjectName(item.projectName || item.projectId) || item.projectId}
                        </span>
                        {item.workItemType ? (
                          <Tag color={typeColors[item.workItemType] || "default"}>{item.workItemType}</Tag>
                        ) : null}
                        {isOverdue ? <span className="gantt-overdue-tag">逾期</span> : null}
                      </div>
                      <div className="gantt-label-desc">
                        {item.title}
                      </div>
                    </div>
                    <Button
                      size="small"
                      className="gantt-label-add"
                      icon={<PlusOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        openChildTask(item);
                      }}
                    />
                  </div>
                <div className="gantt-bar-wrapper" style={{ width: barWidth }}>
                  <Button
                    size="small"
                    className="gantt-child-button"
                    icon={<PlusOutlined />}
                    onClick={(event) => {
                      event.stopPropagation();
                      openChildTask(item);
                    }}
                  />
                  <div
                    className={`gantt-bar${isDone ? " gantt-bar--done" : ""}${isOverdue ? " gantt-bar--overdue" : ""}${isInProgress ? " gantt-bar--inprogress" : ""}${isNotStartedByDate ? " gantt-bar--not-started" : ""}`}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        onClick={() => openEditForm(item)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(evt) => {
                          if (evt.key === "Enter" || evt.key === " ") {
                            evt.preventDefault();
                            openEditForm(item);
                          }
                        }}
                      >
                        <span>
                          {adjustedStart.format("MM-DD")} ~ {end.format("MM-DD")}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const boardGroups = useMemo(() => {
    const groups = {
      todo: [] as any[],
      doing: [] as any[],
      done: [] as any[],
    };
    todos.forEach((item) => {
      if (isNotStarted(item.state)) {
        groups.todo.push(item);
      } else if (isCompleted(item.state)) {
        groups.done.push(item);
      } else {
        groups.doing.push(item);
      }
    });
    return groups;
  }, [todos]);

  const renderBoardView = () => {
    if (tabKey !== "all") {
      return <Empty description="看板仅支持全部视图" />;
    }
    const columns = [
      { key: "todo", title: "待办", state: "New" },
      { key: "doing", title: "进行中", state: "Active" },
      { key: "done", title: "已完成", state: "Closed" },
    ] as const;
    return (
      <div className="kanban-board">
        {columns.map((col) => {
          const items = boardGroups[col.key];
          return (
            <div key={col.key} className="kanban-column">
              <div className="kanban-column-header">
                <span>{col.title}</span>
                <span className="kanban-count">{items.length}</span>
                <Button
                  size="small"
                  className="kanban-add"
                  icon={<PlusOutlined />}
                  onClick={() => openNewTodoWithState(col.state)}
                />
              </div>
              <div className="kanban-column-body">
                {items.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
                ) : (
                  items.map((item) => {
                    const stateKey = (item.state || "").toLowerCase();
                    const desc = stripHtml(item.description);
                    return (
                      <div
                        key={`${item.projectId}-${item.id}`}
                        className="kanban-card"
                        role="button"
                        tabIndex={0}
                        onClick={() => openEditForm(item)}
                        onKeyDown={(evt) => {
                          if (evt.key === "Enter" || evt.key === " ") {
                            evt.preventDefault();
                            openEditForm(item);
                          }
                        }}
                      >
                        <div className="kanban-card-title">{item.title || "Untitled"}</div>
                        {desc ? <div className="kanban-card-desc">{desc}</div> : null}
                        <div className="kanban-card-tags">
                          <Tag color={stateColors[stateKey] || "default"}>{item.state || "-"}</Tag>
                          {item.workItemType ? <Tag color={typeColors[item.workItemType] || "default"}>{item.workItemType}</Tag> : null}
                          {item.priority ? <Tag color={priorityColors[item.priority] || "default"}>{`P${item.priority}`}</Tag> : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const confettiPieces = useMemo(() => {
    if (!confettiActive) return null;
    let seed = confettiSeed || Date.now();
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const palette = ["#22d3ee", "#0ea5e9", "#22c55e", "#f97316", "#ef4444", "#a855f7", "#facc15"];
    return Array.from({ length: 26 }, (_, idx) => {
      const left = rand() * 100;
      const delay = rand() * 0.3;
      const duration = 1.2 + rand() * 0.8;
      const size = 6 + rand() * 6;
      const rotate = Math.floor(rand() * 360);
      const color = palette[Math.floor(rand() * palette.length)];
      return (
        <span
          key={`${confettiSeed}-${idx}`}
          className="confetti-piece"
          style={{
            left: `${left}%`,
            width: `${size}px`,
            height: `${Math.max(4, size * 0.6)}px`,
            background: color,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
            ["--confetti-rotate" as any]: `${rotate}deg`,
          }}
        />
      );
    });
  }, [confettiActive, confettiSeed]);

  const totalRemaining = useMemo(
    () =>
      todos.reduce((sum, item) => {
        const v = (item as any).originalEstimate;
        const n = typeof v === "number" ? v : v ? Number(v) : 0;
        return sum + (isNaN(n) ? 0 : n);
      }, 0),
    [todos]
  );

  const [parentDetails, setParentDetails] = useState<Record<number, any>>({});

  const todoById = useMemo(() => {
    const map: Record<number, any> = {};
    todos.forEach((item) => {
      if (typeof item?.id === "number") {
        map[item.id] = item;
      }
    });
    return map;
  }, [todos]);

  useEffect(() => {
    const lookup = new Map<number, string>();
    todos.forEach((item) => {
      if (item.parentId && item.projectId) {
        if (!parentDetails[item.parentId] && !todoById[item.parentId]) {
          if (!lookup.has(item.parentId)) {
            lookup.set(item.parentId, item.projectId);
          }
        }
      }
    });
    if (lookup.size === 0) return;
    let cancelled = false;
    (async () => {
      const entries = Array.from(lookup.entries());
      const results = await Promise.all(
        entries.map(async ([parentId, projectId]) => {
          try {
            const res = await api.getTodo(projectId, parentId);
            return { parentId, projectId, todo: res.todo };
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setParentDetails((prev) => {
        const next = { ...prev };
        results.forEach((entry) => {
          if (entry?.todo) {
            const enriched = {
              ...entry.todo,
              projectId: entry.todo.projectId || entry.projectId,
              projectName: entry.todo.projectName,
            };
            next[entry.parentId] = enriched;
          }
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [todos, todoById]);

  const remainingByProject = useMemo(() => {
    const map: Record<string, number> = {};
    todos.forEach((item) => {
      const key = (normalizeProjectName(item.projectName || item.project) || item.project || "Unknown").toString();
      const v = (item as any).originalEstimate;
      const n = typeof v === "number" ? v : v ? Number(v) : 0;
      if (!isNaN(n)) {
        map[key] = (map[key] || 0) + n;
      }
    });
    return map;
  }, [todos]);

  const alignmentTree = useMemo(() => {
    if (!alignmentEpic) return null;
    const byId: Record<number, any> = {};
    alignmentItems.forEach((item) => {
      if (typeof item?.id === "number") {
        byId[item.id] = item;
      }
    });
    if (alignmentEpic?.id) {
      byId[alignmentEpic.id] = alignmentEpic;
    }
    const childrenMap: Record<number, number[]> = {};
    alignmentItems.forEach((item) => {
      const parentId = item.parentId;
      if (!parentId) return;
      if (!childrenMap[parentId]) {
        childrenMap[parentId] = [];
      }
      childrenMap[parentId].push(item.id);
    });

    const buildNode = (id: number, visited: Set<number>) => {
      if (visited.has(id)) return null;
      const item = byId[id];
      if (!item) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(id);
      const childIds = childrenMap[id] || [];
      const sortedChildIds = [...childIds].sort((a, b) => {
        const aCreated = byId[a]?.createdDate ? new Date(byId[a].createdDate).getTime() : 0;
        const bCreated = byId[b]?.createdDate ? new Date(byId[b].createdDate).getTime() : 0;
        if (aCreated === bCreated) return b - a;
        return bCreated - aCreated;
      });
      const children = sortedChildIds
        .map((childId) => buildNode(childId, nextVisited))
        .filter((node): node is { item: any; children: any[] } => Boolean(node));
      return { item, children };
    };

    return buildNode(alignmentEpic.id, new Set());
  }, [alignmentEpic, alignmentItems]);

  const renderAlignmentCard = (item: any) => {
    const avatarSrc = proxyAzureResourceUrl(item.assignedToAvatar);
    const initials = (item.assignedTo || "?")
      .split(" ")
      .map((part: string) => part.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2);
    const stateKey = (item.state || "").toLowerCase();
    const estimateValue = item.originalEstimate;
    const estimateText =
      typeof estimateValue === "number" && !Number.isNaN(estimateValue) ? `${estimateValue}h` : "-";
    return (
      <div
        className="alignment-node-card"
        onClick={() => openEditForm(item)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openEditForm(item);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <Typography.Text strong>{item.title || "Untitled"}</Typography.Text>
        <div className="alignment-status-row">
          <Tag color={stateColors[stateKey] || "default"} className="alignment-status-tag">
            {item.state || "-"}
          </Tag>
          <Typography.Text type="secondary" className="alignment-estimate">
            预计工时: {estimateText}
          </Typography.Text>
        </div>
        <div className="alignment-meta">
          <div className="assignee-avatar" title={item.assignedTo || ""}>
            {avatarSrc ? <img src={avatarSrc} alt={item.assignedTo || "User"} /> : initials || "-"}
          </div>
          <Tag color={typeColors[item.workItemType] || "default"}>{item.workItemType || "-"}</Tag>
          {item.priority ? <Tag color={priorityColors[item.priority] || "default"}>{`P${item.priority}`}</Tag> : null}
        </div>
        <Button
          size="small"
          className="alignment-child-button"
          icon={<PlusOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            openChildTask(item);
          }}
        />
      </div>
    );
  };

  const renderMindmapNode = (node: { item: any; children: any[] }) => {
    const renderedChildren = node.children
      .map((child) => ({ child, element: renderMindmapNode(child) }))
      .filter(({ element }) => Boolean(element));
    const hasVisibleChildren = renderedChildren.length > 0;
    if (hideNotStarted && isNotStarted(node.item.state)) return null;
    if (hideCompleted && isCompleted(node.item.state) && !hasVisibleChildren) return null;
    return (
      <div className="mindmap-node">
        <div className="mindmap-card">{renderAlignmentCard(node.item)}</div>
        {hasVisibleChildren && (
          <div className="mindmap-children">
            {renderedChildren.map(({ child, element }) => (
              <div key={child.item.id} className="mindmap-child">
                {element}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const cardTitle = useMemo(() => {
    if (!forcedProjectId) return t("allTodos.title", "All Projects - To-Dos");
    const match = projects.find((p) => p.value === forcedProjectId);
    if (match) {
      return `${match.label} - ${t("allTodos.todoSuffix", "To-Dos")}`;
    }
    return t("allTodos.projectFallback", "Project To-Dos");
  }, [forcedProjectId, projects, t]);

  const openNewTodoWithState = (state: string) => {
    setEditing(null);
    form.resetFields();
    if (currentUser) {
      form.setFieldsValue({ assignedTo: currentUser });
    }
    if (forcedProjectId) {
      form.setFieldsValue({ projectId: forcedProjectId });
      loadTags(forcedProjectId);
      loadAreas(forcedProjectId);
      loadIterations(forcedProjectId);
      loadParents(forcedProjectId);
    }
    form.setFieldsValue({ state });
    setDrawerOpen(true);
  };

  const openChildTask = (record: any) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      projectId: record.projectId,
      title: "",
      assignedTo: currentUser || record.assignedTo,
      state: "New",
      priority: 2,
      originalEstimate: undefined,
      plannedStartDate: undefined,
      targetDate: undefined,
      description: "",
      tags: [],
      workItemType: "Task",
      parentId: record.id,
      areaPath: record.areaPath,
      iterationPath: record.iterationPath,
    });
    loadTags(record.projectId);
    loadAreas(record.projectId);
    loadIterations(record.projectId);
    loadParents(record.projectId);
    setComments([]);
    setDrawerOpen(true);
  };

  const openEditForm = (record: any) => {
    if (!record) return;
    setEditing(record);
    form.setFieldsValue({
      projectId: record.projectId,
      title: record.title,
      assignedTo: record.assignedTo,
      priority: record.priority,
      originalEstimate: (record as any).originalEstimate,
      plannedStartDate: record.plannedStartDate ? dayjs(record.plannedStartDate) : null,
      targetDate: record.targetDate ? dayjs(record.targetDate) : null,
      state: record.state,
      description: record.description,
      tags: record.tags,
      workItemType: record.workItemType,
      areaPath: record.areaPath,
      iterationPath: record.iterationPath,
      parentId: record.parentId,
    });
    loadTags(record.projectId);
    loadAreas(record.projectId);
    loadIterations(record.projectId);
    loadParents(record.projectId);
    loadComments(record.projectId, record.id);
    setDrawerOpen(true);
  };

  const openParentRecord = async (record: any) => {
    if (!record?.parentId || !record.projectId) return;
    const cached = todoById[record.parentId] || parentDetails[record.parentId];
    if (cached) {
      openEditForm({ ...cached, projectId: cached.projectId || record.projectId, projectName: cached.projectName || record.projectName });
      return;
    }
    setLoading(true);
    try {
      const res = await api.getTodo(record.projectId, record.parentId);
      const todo = { ...res.todo, projectId: record.projectId, projectName: record.projectName };
      setParentDetails((prev) => ({ ...prev, [record.parentId]: todo }));
      openEditForm(todo);
    } catch (err: any) {
      message.error(err.message || "Failed to open parent");
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number, pageSize?: number) => {
    const next = { ...filters, page, pageSize: pageSize || filters.pageSize };
    const enforced = applyFilters(next);
    persistFilters(enforced);
    loadTodos(enforced);
  };

  const handleTabChange = (key: string) => {
    const normalized = (key as TabKey) || "all";
    setTabKey(normalized);
    const next = { ...filters, page: 1 };
    if (normalized === "no-start") {
      next.state = "New";
    } else if (normalized === "on-going") {
      next.state = undefined;
    } else if (normalized === "completed") {
      next.state = undefined;
      if (!next.closedFrom && !next.closedTo) {
        const range = getCurrentWeekRange();
        next.closedFrom = range.from;
        next.closedTo = range.to;
      }
    } else {
      next.state = filters.state;
    }
    const enforced = applyFilters(next);
    persistFilters(enforced);
    loadTodos(enforced, normalized);
  };

  useEffect(() => {
    if (tabInitRef.current) return;
    tabInitRef.current = true;
    if (!tabFromQuery || tabFromQuery === tabKey) return;
    handleTabChange(tabFromQuery);
  }, [tabFromQuery, tabKey]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const openTodoId = params.get("openTodoId");
    if (!openTodoId) {
      todoOpenRef.current = null;
      return;
    }
    if (todoOpenRef.current === openTodoId) return;
    todoOpenRef.current = openTodoId;
    const projectId = forcedProjectId || params.get("projectId");
    if (!projectId) return;
    setLoading(true);
    api
      .getTodo(projectId, Number(openTodoId))
      .then((res) => {
        if (res?.todo) {
          openEditForm({ ...res.todo, projectId });
        }
      })
      .catch((err: any) => {
        message.error(err.message || "Failed to open item");
      })
      .finally(() => setLoading(false));
  }, [forcedProjectId, location.search]);

  const loadComments = async (projectId?: string, workItemId?: number) => {
    if (!projectId || !workItemId) {
      setComments([]);
      return;
    }
    setCommentLoading(true);
    try {
      const res = await api.listComments(projectId, workItemId);
      const sorted = [...(res.comments || [])].sort((a, b) => {
        const aTime = new Date(a.createdDate || 0).getTime();
        const bTime = new Date(b.createdDate || 0).getTime();
        return bTime - aTime;
      });
      setComments(sorted);
    } catch (err: any) {
      message.error(err.message || "Failed to load comments");
    } finally {
      setCommentLoading(false);
    }
  };

  const prefetchLatestComments = useCallback(
    async (items: any[]) => {
      if (!items || items.length === 0) {
        latestCommentRequestRef.current = Date.now();
        setLatestCommentMap({});
        return;
      }
      const requestId = Date.now();
      latestCommentRequestRef.current = requestId;
      const subset = items.slice(0, 40);
      const results = await Promise.all(
        subset.map(async (item) => {
          if (!item?.projectId || !item?.id) return null;
          try {
            const res = await api.listComments(item.projectId, item.id);
            const comments = res.comments || [];
            if (!comments.length) return null;
            const latest = comments.reduce((prev, curr) => {
              if (!prev) return curr;
              const prevTime = new Date(prev.createdDate || 0).getTime();
              const currTime = new Date(curr.createdDate || 0).getTime();
              return currTime > prevTime ? curr : prev;
            }, comments[0]);
            return { key: `${item.projectId}-${item.id}`, comment: latest };
          } catch {
            return null;
          }
        })
      );
      if (latestCommentRequestRef.current !== requestId) {
        return;
      }
      const fetched: Record<string, LatestCommentPreview> = {};
      results.forEach((entry) => {
        if (entry?.comment) {
          fetched[entry.key] = {
            preview: summarizeCommentText(entry.comment.text || ""),
            createdBy: entry.comment.createdBy,
            createdDate: entry.comment.createdDate,
          };
        }
      });
      setLatestCommentMap((prev) => {
        const next: Record<string, LatestCommentPreview> = {};
        items.forEach((item) => {
          const key = `${item.projectId}-${item.id}`;
          next[key] = fetched[key] || prev[key];
        });
        return next;
      });
    },
    []
  );

  useEffect(() => {
    prefetchLatestComments(todos);
  }, [todos, prefetchLatestComments]);

  const loadTags = async (projectId?: string, search?: string) => {
    if (!projectId) {
      setTagOptions([]);
      return;
    }
    try {
      const res = await api.listTags(projectId, search);
      const options = (res.tags || []).map((t) => ({ label: t, value: t }));
      setTagOptions(options);
    } catch {
      setTagOptions([]);
    }
  };

  const loadAreas = async (projectId?: string, search?: string) => {
    if (!projectId) {
      setAreaOptions([]);
      return;
    }
    try {
      const res = await api.listAreas(projectId, search);
      const options = (res.areas || []).map((a) => ({ label: a, value: a }));
      setAreaOptions(options);
    } catch {
      setAreaOptions([]);
    }
  };

  const loadIterations = async (projectId?: string, search?: string) => {
    if (!projectId) {
      setIterationOptions([]);
      return;
    }
    try {
      const res = await api.listIterations(projectId, search);
      const options = (res.iterations || []).map((i) => ({ label: i, value: i }));
      setIterationOptions(options);
    } catch {
      setIterationOptions([]);
    }
  };

  const formatParentLabel = (item: any) => {
    const type = (item.workItemType || "").toString();
    const typePrefix =
      type === "Epic"
        ? "epic"
        : type === "Feature"
        ? "feature"
        : type === "User Story"
        ? "us"
        : type === "Task"
        ? "task"
        : type === "Bug"
        ? "bug"
        : type.toLowerCase();
    const base = typePrefix ? `${typePrefix}-${item.id}` : `${item.id}`;
    const owner = item.assignedTo || "-";
    return `${base} - ${owner} - ${item.title || "Untitled"}`;
  };

  const loadParents = async (projectId?: string, search?: string) => {
    if (!projectId) {
      setParentOptions([]);
      return;
    }
    try {
      let items: any[] = [];
      const trimmed = (search || "").trim();

      // 纯数字优先按 ID 精确查一条
      if (trimmed && /^\d+$/.test(trimmed)) {
        try {
          const detail = await api.getTodo(projectId, Number(trimmed));
          if (detail?.todo) {
            items = [detail.todo];
          }
        } catch {
          // ignore, fall back to listTodos
        }
      }

      if (items.length === 0) {
        // Fetch candidate parents across all work item types
        const res = await api.listTodos(projectId, { keyword: search, page: 1, pageSize: 50 });
        items = res.todos || [];
      }

      let options = items.map((t) => ({
        label: formatParentLabel(t),
        value: t.id,
      }));
      const currentParentId = form.getFieldValue("parentId");
      if (currentParentId && !options.find((o) => o.value === currentParentId)) {
        try {
          const detail = await api.getTodo(projectId, currentParentId);
          const parent = detail.todo || { id: currentParentId, title: "Parent" };
          options = [{ label: formatParentLabel(parent), value: currentParentId }, ...options];
        } catch {
          options = [{ label: String(currentParentId), value: currentParentId }, ...options];
        }
      }
      setParentOptions(options);
    } catch {
      setParentOptions([]);
    }
  };

  const fetchMentionOptions = async (keyword: string) => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setMentionOptions([]);
      return;
    }
    setMentionLoading(true);
    try {
      const res = await api.searchIdentities(trimmed);
      const options = (res.identities || []).map((identity) => {
        const label = identity.displayName || identity.uniqueName || identity.mail || identity.descriptor || trimmed;
        return { label, value: identity.id || identity.descriptor || label, identity };
      });
      setMentionOptions(options);
    } catch (err: any) {
      message.error(err.message || "Failed to search users");
    } finally {
      setMentionLoading(false);
    }
  };

  const buildMentionHtml = (identity: Identity) => {
    const safeName = identity.displayName || identity.uniqueName || identity.mail || "User";
    const parts = ["version:2.0", "type:person", `name:${safeName}`];
    if (identity.id) parts.push(`id:${identity.id}`);
    if (identity.descriptor) {
      parts.push(`descriptor:${identity.descriptor}`);
      parts.push(`ref:${identity.descriptor}`);
    }
    if (identity.uniqueName) parts.push(`uniqueName:${identity.uniqueName}`);
    if (identity.mail) parts.push(`mailto:${identity.mail}`);
    const attr = parts.join(",");
    return `<a class="mention" data-vss-mention="${attr}" data-vss-mention-name="${safeName}" href="#">@${safeName}</a>&nbsp;`;
  };

  const insertMention = (identity: Identity) => {
    const html = buildMentionHtml(identity);
    commentEditorRef.current?.focus();
    commentEditorRef.current?.insertHtml(html);
    setMentionPickerOpen(false);
    setMentionSearchValue("");
  };

  const handleAddComment = async (text: string) => {
    if (!editing?.id || !editing?.projectId) return;
    setCommentLoading(true);
    try {
      await api.addComment(editing.projectId, editing.id, text);
      await loadComments(editing.projectId, editing.id);
      message.success("Comment posted");
    } catch (err: any) {
      message.error(err.message || "Failed to post comment");
    } finally {
      setCommentLoading(false);
    }
  };

  const handleCreate = async (options?: { temporary?: boolean }) => {
    const values = options?.temporary ? await form.validateFields({ validateOnly: true }).then(() => form.getFieldsValue()) : await form.validateFields();
    const cleanArea = typeof values.areaPath === "string" ? values.areaPath.replace(/^[/\\]+/, "") : values.areaPath;
    const cleanIteration =
      typeof values.iterationPath === "string" ? values.iterationPath.replace(/^[/\\]+/, "") : values.iterationPath;
    const parentId =
      values.parentId !== undefined && values.parentId !== null ? Number(values.parentId) : null;
    const originalEstimate = values.originalEstimate;
    const desiredState = values.state || "New";
    const stateLower = desiredState.toString().toLowerCase();
    const isClosed = stateLower === "closed" || stateLower === "resolved";
    const wasClosed = editing ? isCompleted(editing.state) : false;
    const shouldCelebrate = !options?.temporary && isClosed && (!editing || !wasClosed);
    let remainingValue = values.remaining;
    const todayStart = dayjs().startOf("day").toISOString();
    const todayEnd = dayjs().endOf("day").toISOString();
    let plannedStartDateValue = serializeDateValue(values.plannedStartDate);
    let targetDateValue = serializeDateValue(values.targetDate);
    const isActive = stateLower === "active";
    const isEditingNew = editing && (editing.state || "").toString().toLowerCase() === "new";
    if (editing && isActive && !isEditingNew) {
      if (!plannedStartDateValue) plannedStartDateValue = todayStart;
      if (!targetDateValue) targetDateValue = todayEnd;
    }
    if (remainingValue == null && originalEstimate != null && !isClosed) {
      // 非关闭状态下，如果没单独填 Remaining，则默认与 Original Estimate 相同
      remainingValue = originalEstimate;
    }
    try {
      setLoading(true);
      let savedTodo: any = null;
      if (editing) {
        const updatePayload: any = {
          title: values.title,
          assignedTo: values.assignedTo,
          priority: values.priority,
          originalEstimate,
          state: desiredState,
          description: values.description,
          tags: values.tags,
          areaPath: cleanArea,
          iterationPath: cleanIteration,
          parentId,
        };
        if (plannedStartDateValue !== undefined) {
          updatePayload.plannedStartDate = plannedStartDateValue;
        }
        if (targetDateValue !== undefined) {
          updatePayload.targetDate = targetDateValue;
        }
        // 编辑已关闭的 item 时，不再自动改写 Remaining
        if (!isClosed && remainingValue != null) {
          updatePayload.remaining = remainingValue;
        }
        const updated = await api.updateTodo(values.projectId, editing.id, updatePayload);
        savedTodo = updated?.todo || null;
        message.success(options?.temporary ? "Temporarily saved" : "Updated");
      } else {
        const initialState = isClosed ? "Active" : desiredState;
        const created = await api.createTodo(values.projectId, {
          title: values.title,
          assignedTo: values.assignedTo,
          priority: values.priority,
          state: initialState,
          description: values.description,
          tags: values.tags,
          areaPath: cleanArea,
          iterationPath: cleanIteration,
          workItemType: values.workItemType || "User Story",
          parentId,
          originalEstimate,
          remaining: remainingValue,
          plannedStartDate: plannedStartDateValue,
          targetDate: targetDateValue,
        });
        savedTodo = created?.todo || null;
        if (isClosed && created?.todo?.id) {
          const updated = await api.updateTodo(values.projectId, created.todo.id, { state: desiredState });
          savedTodo = updated?.todo || savedTodo;
        }
        message.success("Created");
      }
      await loadTodos(
        { ...filters, page: pagination.current, pageSize: pagination.pageSize },
        tabKey
      );
      if (!options?.temporary) {
        setDrawerOpen(false);
        setEditing(null);
        form.resetFields();
      }
      if (alignmentEpic) {
        await refreshAlignmentNodes({
          projectId: values.projectId,
          itemId: savedTodo?.id || editing?.id,
          parentId,
          updatedItem: savedTodo || undefined,
        });
      }
      if (shouldCelebrate) {
        triggerConfetti();
      }
    } catch (err: any) {
      message.error(err.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  const alignmentView = alignmentEpic ? (
    <Card className="alignment-card">
        <div className="alignment-header">
          <div>
            <Typography.Title level={3} className="alignment-title">
              {t("alignment.title", "对齐视图")}
            </Typography.Title>
          </div>
          <Space>
            <Button
              icon={hideNotStarted ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              onClick={() => setHideNotStarted((prev) => !prev)}
            >
              {hideNotStarted ? t("alignment.showNew", "显示未开始") : t("alignment.hideNew", "隐藏未开始")}
            </Button>
            <Button
              icon={hideCompleted ? <EyeOutlined /> : <EyeInvisibleOutlined />}
              onClick={() => setHideCompleted((prev) => !prev)}
            >
              {hideCompleted ? t("alignment.showDone", "显示已完成") : t("alignment.hideDone", "隐藏已完成")}
            </Button>
            <Button icon={<LeftOutlined />} onClick={() => setAlignmentEpic(null)}>
              {t("alignment.back", "返回上一级")}
            </Button>
          </Space>
        </div>
        <div className="alignment-body">
          <div className="alignment-tree">
            {alignmentLoading ? (
              <Empty description={t("alignment.loading", "加载中...")} />
          ) : !alignmentTree ? (
            <Empty description={t("alignment.empty", "暂无对齐任务")} />
          ) : (
            <>
              <div className="mindmap-controls">
                <Button onClick={() => setAlignmentZoom((prev) => Math.min(1.5, Number((prev + 0.1).toFixed(2))))}>
                  {t("alignment.zoomIn", "放大")}
                </Button>
                <Button onClick={() => setAlignmentZoom((prev) => Math.max(0.6, Number((prev - 0.1).toFixed(2))))}>
                  {t("alignment.zoomOut", "缩小")}
                </Button>
                <Button onClick={() => setAlignmentZoom(1)}>{t("alignment.zoomReset", "重置")}</Button>
              </div>
              <div
                className="mindmap-viewport"
                ref={alignmentViewportRef}
                onPointerDown={handleAlignmentPointerDown}
                onPointerMove={handleAlignmentPointerMove}
                onPointerUp={handleAlignmentPointerUp}
                onPointerLeave={handleAlignmentPointerUp}
              >
                <div className="mindmap" style={{ transform: `scale(${alignmentZoom})` }}>
                  {renderMindmapNode(alignmentTree)}
                </div>
              </div>
            </>
            )}
          </div>
        </div>
      </Card>
  ) : null;

  return (
    <>
      {confettiActive ? <div className="confetti-overlay">{confettiPieces}</div> : null}
      {alignmentEpic ? (
        alignmentView
      ) : (
        <Card
      title={cardTitle}
      extra={
        <Space align="center" size={24}>
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary">
              {t("metrics.totalEffort", "Total Effort")}: <span style={{ fontWeight: 600 }}>{totalRemaining}</span>
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {Object.entries(remainingByProject)
                .map(([name, hours]) => `${name}: ${hours}`)
                .join(" | ")}
            </Typography.Text>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => loadTodos()}>
            {t("buttons.refresh", "Refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              if (currentUser) {
                form.setFieldsValue({ assignedTo: currentUser });
              }
              if (forcedProjectId) {
                form.setFieldsValue({ projectId: forcedProjectId });
                loadTags(forcedProjectId);
                loadAreas(forcedProjectId);
                loadIterations(forcedProjectId);
                loadParents(forcedProjectId);
              }
              setDrawerOpen(true);
            }}
          >
            {t("buttons.newTodo", "New To-Do")}
          </Button>
        </Space>
      }
    >
      <Tabs
        activeKey={tabKey}
        onChange={handleTabChange}
        items={[
          { key: "all", label: t("tabs.all", "All") },
          { key: "no-start", label: t("tabs.noStart", "No-Start") },
          { key: "on-going", label: t("tabs.onGoing", "On-Going") },
          { key: "completed", label: t("tabs.completed", "Completed") },
        ]}
        style={{ marginBottom: 12 }}
      />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}>
          <Input
            placeholder={t("filters.searchTitle", "Search title")}
            value={keywordInput}
            allowClear
            onChange={(e) => {
              setKeywordInput(e.target.value || "");
            }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Input
            placeholder={t("filters.assigned", "Assigned to")}
            allowClear
            value={assignedInput}
            onChange={(e) => {
              setAssignedInput(e.target.value || "");
            }}
          />
        </Col>
        <Col xs={24} md={5}>
          <Select
            allowClear
            placeholder={t("filters.state", "State")}
            style={{ width: "100%" }}
            disabled={tabKey !== "all"}
            onChange={(value) => {
              const next = { ...filters, state: value || undefined, page: 1 };
              const enforced = applyFilters(next);
              persistFilters(enforced);
              loadTodos(enforced);
            }}
            options={["New", "Active", "Resolved", "Closed", "Removed"].map((value) => ({
              label: value,
              value,
            }))}
          />
        </Col>
        <Col xs={24} md={4}>
          <Select
            mode="multiple"
            allowClear
            placeholder={t("filters.workItemType", "Work item type")}
            style={{ width: "100%" }}
            value={
              filters.type === NO_EPIC_SENTINEL
                ? DEFAULT_WORK_ITEM_TYPES
                : filters.type
                ? filters.type.split(",")
                : undefined
            }
            maxTagCount="responsive"
            onChange={(values: string[]) => {
              let typeValue: string | undefined;
              if (!values || values.length === 0) {
                // 清空时仍默认排除 Epic
                typeValue = NO_EPIC_SENTINEL;
              } else {
                const allNoEpicSelected =
                  values.length === DEFAULT_WORK_ITEM_TYPES.length &&
                  DEFAULT_WORK_ITEM_TYPES.every((t) => values.includes(t));
                const allTypesSelected =
                  values.length === ALL_WORK_ITEM_TYPES.length &&
                  ALL_WORK_ITEM_TYPES.every((t) => values.includes(t));

                if (allNoEpicSelected && !values.includes("Epic")) {
                  typeValue = NO_EPIC_SENTINEL;
                } else if (allTypesSelected) {
                  // 选中所有类型则不再做类型过滤
                  typeValue = undefined;
                } else {
                  typeValue = values.join(",");
                }
              }
              const next = { ...filters, type: typeValue, page: 1 };
              const enforced = applyFilters(next);
              persistFilters(enforced);
              loadTodos(enforced);
            }}
            options={ALL_WORK_ITEM_TYPES.map((value) => ({
              label: value,
              value,
            }))}
          />
        </Col>
        <Col xs={24} md={3}>
          <Button type="primary" icon={<SearchOutlined />} onClick={applySearchFilters} block>
            {t("filters.search", "Search")}
          </Button>
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 12 }}>
        {!hideProjectSelector && (
          <Col xs={24} md={6}>
            <Select
              allowClear
              showSearch
              placeholder={t("filters.project", "Project")}
              style={{ width: "100%" }}
              value={filters.project}
              options={projects}
              optionFilterProp="label"
              onChange={(value) => {
                const next = { ...filters, project: value || undefined, page: 1 };
                const enforced = applyFilters(next);
                persistFilters(enforced);
                loadTodos(enforced);
              }}
            />
          </Col>
        )}
        {tabKey === "on-going" && (
          <>
            <Col xs={24} md={8}>
              <DatePicker.RangePicker
                style={{ width: "100%" }}
                allowClear
                placeholder={[t("filters.plannedFrom", "Planned start from"), t("filters.plannedTo", "Planned start to")]}
                value={
                  filters.plannedFrom || filters.plannedTo
                    ? [
                        filters.plannedFrom ? dayjs(filters.plannedFrom) : null,
                        filters.plannedTo ? dayjs(filters.plannedTo) : null,
                      ]
                    : undefined
                }
                onChange={(values) => {
                  const [start, end] = values || [];
                  const next = {
                    ...filters,
                    plannedFrom: start ? start.startOf("day").toDate().toISOString() : undefined,
                    plannedTo: end ? end.endOf("day").toDate().toISOString() : undefined,
                    page: 1,
                  };
                  const enforced = applyFilters(next);
                  persistFilters(enforced);
                  loadTodos(enforced, "on-going");
                }}
              />
            </Col>
            <Col xs={24} md={hideProjectSelector ? 10 : 8}>
              <Space wrap>
                <Button size="small" onClick={() => applyPlannedRangeShortcut(getDayRange(0))}>
                  {t("filters.today", "Today")}
                </Button>
                <Button size="small" onClick={() => applyPlannedRangeShortcut(getRelativeWeekRange(0))}>
                  {t("filters.thisWeek", "This Week")}
                </Button>
                <Button size="small" onClick={() => applyPlannedRangeShortcut(getRelativeWeekRange(1))}>
                  {t("filters.nextWeek", "Next Week")}
                </Button>
              </Space>
            </Col>
          </>
        )}
        {tabKey === "completed" && (
          <>
            <Col xs={24} md={8}>
              <DatePicker.RangePicker
                style={{ width: "100%" }}
                placeholder={[t("filters.closedFrom", "Closed from"), t("filters.closedTo", "Closed to")]}
                value={
                  filters.closedFrom && filters.closedTo
                    ? [dayjs(filters.closedFrom), dayjs(filters.closedTo)]
                    : undefined
                }
                onChange={(values) => {
                  const [start, end] = values || [];
                  const next = {
                    ...filters,
                    closedFrom: start ? start.startOf("day").toDate().toISOString() : undefined,
                    closedTo: end ? end.endOf("day").toDate().toISOString() : undefined,
                    page: 1,
                  };
                  const enforced = applyFilters(next);
                  persistFilters(enforced);
                  loadTodos(enforced, "completed");
                }}
              />
            </Col>
            <Col xs={24} md={10}>
              <Space wrap>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getRelativeWeekRange(0))}>
                  {t("filters.thisWeek", "This Week")}
                </Button>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getRelativeWeekRange(-1))}>
                  {t("filters.lastWeek", "Last Week")}
                </Button>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getRelativeWeekRange(-2))}>
                  {t("filters.twoWeeksAgo", "Two Weeks Ago")}
                </Button>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getCurrentMonthRange())}>
                  {t("filters.thisMonth", "This Month")}
                </Button>
              </Space>
            </Col>
          </>
        )}
      </Row>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Space>
          <Segmented
            value={viewMode}
            onChange={(value) => setViewMode(value as "table" | "gantt" | "board")}
            options={[
              {
                label: (
                  <Space size={6}>
                    <UnorderedListOutlined />
                    {t("views.list", "List View")}
                  </Space>
                ),
                value: "table",
              },
              {
                label: (
                  <Space size={6}>
                    <BarChartOutlined />
                    {t("views.gantt", "Gantt View")}
                  </Space>
                ),
                value: "gantt",
              },
              {
                label: (
                  <Space size={6}>
                    <LinkOutlined />
                    {t("views.board", "Board View")}
                  </Space>
                ),
                value: "board",
                disabled: tabKey !== "all",
              },
            ]}
          />
        </Space>
        <Space>
          <Button icon={<ClearOutlined />} onClick={clearFilters} disabled={!hasActiveFilters}>
            {t("filters.clear", "Clear Filters")}
          </Button>
        </Space>
      </Row>

      {viewMode === "gantt" ? (
        renderGanttView()
      ) : viewMode === "board" ? (
        renderBoardView()
      ) : (
        <Table<any>
          dataSource={todos}
          loading={loading}
          rowKey={(row) => `${row.projectId}-${row.id}`}
          scroll={{ x: 1400 }}
         onRow={(record) => ({
         onDoubleClick: () => {
            openEditForm(record);
         },
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          pageSizeOptions: ["20", "50", "100", "200"],
          onChange: handlePageChange,
          defaultPageSize: 100,
        }}
          columns={[
          {
            title: t("table.assignedTo", "Assigned To"),
            dataIndex: "assignedTo",
            width: 80,
            sorter: stringSorter((item) => (item.assignedTo || "").toLowerCase()),
            render: (_: any, record) => {
              const avatarSrc = proxyAzureResourceUrl(record.assignedToAvatar);
              const initials = (record.assignedTo || "?")
                .split(" ")
                .map((part: string) => part.charAt(0).toUpperCase())
                .join("")
                .slice(0, 2);
              return (
                <div className="assignee-avatar" title={record.assignedTo || ""}>
                  {avatarSrc ? <img src={avatarSrc} alt={record.assignedTo || "User"} /> : initials || "-"}
                </div>
              );
            },
          },
          {
            title: t("table.project", "Project"),
            dataIndex: "projectName",
            width: 140,
            sorter: stringSorter((item) => getProjectSortKey(item).toLowerCase()),
            render: (projectName?: string) => (
              <span className="project-badge" style={projectBadgeStyle(projectName)}>
                {normalizeProjectName(projectName) || "-"}
              </span>
            ),
          },
          {
            title: t("table.parent", "Parent"),
            dataIndex: "parentId",
            width: 220,
            sorter: stringSorter((item) => {
              const parentRecord = todoById[item.parentId] || parentDetails[item.parentId];
              return (item.parentTitle || parentRecord?.title || `#${item.parentId || ""}`).toLowerCase();
            }),
            render: (_, record) => {
              if (!record.parentId) return <span className="parent-cell">-</span>;
              const parentRecord = todoById[record.parentId] || parentDetails[record.parentId];
              const label = record.parentTitle || parentRecord?.title || `#${record.parentId}`;
              return (
                <button
                  type="button"
                  className="parent-link"
                  onClick={() => openParentRecord(record)}
                >
                  {label}
                </button>
              );
            },
          },
          {
            title: t("table.title", "Title"),
            dataIndex: "title",
            ellipsis: true,
            width: 280,
            sorter: stringSorter((item) => (item.title || "").toLowerCase()),
            render: (value: string, record) => {
              const title = value || "-";
              return (
                <div className="table-title-cell">
                  <span className="table-title-text" title={title}>
                    {title}
                  </span>
                  {record.workItemType ? (
                    <Tag className="table-title-type" color={typeColors[record.workItemType] || "default"}>
                      {record.workItemType}
                    </Tag>
                  ) : null}
                  {isOverdue(record) ? <span className="table-overdue-tag">逾期</span> : null}
                </div>
              );
            },
          },
          {
            title: t("table.type", "Type"),
            dataIndex: "workItemType",
            width: 120,
            sorter: stringSorter((item) => (item.workItemType || "").toLowerCase()),
            render: (value?: string) => (value ? <Tag color={typeColors[value] || "default"}>{value}</Tag> : "-"),
          },
          {
            title: t("table.priority", "Priority"),
            dataIndex: "priority",
            width: 110,
            sorter: (a, b) => (a.priority || 0) - (b.priority || 0),
            render: (value?: number) =>
              value ? <Tag color={priorityColors[value] || "default"}>{`P${value}`}</Tag> : "-",
          },
          ...(tabKey === "all"
            ? [
                {
                  title: t("table.state", "State"),
                  dataIndex: "state",
                  width: 100,
                  sorter: stringSorter((item) => (item.state || "").toLowerCase()),
                  render: (value?: string) => {
                    const key = (value || "").toLowerCase();
                    return value ? <Tag color={stateColors[key] || "default"}>{value}</Tag> : "-";
                  },
                },
              ]
            : []),
          {
            title: t("table.discussion", "Discussion"),
            dataIndex: "latestDiscussion",
            width: 360,
            render: (_, record) => {
              const key = `${record.projectId}-${record.id}`;
              const preview = latestCommentMap[key];
              if (!preview) {
                return <span className="discussion-preview-empty">{t("table.noDiscussion", "No discussion")}</span>;
              }
              return (
                <div className="discussion-preview-cell">
                  <div className="discussion-preview-meta">
                    <span className="author" title={preview.createdBy || ""}>{preview.createdBy || "Unknown"}</span>
                    <span className="time">
                      {preview.createdDate ? dayjs(preview.createdDate).format("MM-DD HH:mm") : ""}
                    </span>
                  </div>
                  <div className="discussion-preview-text" title={preview.preview}>
                    {preview.preview}
                  </div>
                </div>
              );
            },
          },
          {
            title: t("table.targetDate", "Target Date"),
            dataIndex: "targetDate",
            width: 150,
            sorter: (a, b) => {
              const dateA = a.targetDate ? new Date(a.targetDate).getTime() : 0;
              const dateB = b.targetDate ? new Date(b.targetDate).getTime() : 0;
              return dateA - dateB;
            },
            render: (value?: string) => (value ? dayjs(value).format("YYYY-MM-DD") : "-"),
          },
          {
            title: t("table.lastUpdated", "Last Updated"),
            dataIndex: "changedDate",
            width: 180,
            sorter: (a, b) => {
              const dateA = new Date(a.changedDate || a.createdDate || 0).getTime();
              const dateB = new Date(b.changedDate || b.createdDate || 0).getTime();
              return dateA - dateB;
            },
            render: (_: any, record) => {
              const value = record.changedDate || record.createdDate;
              return value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "-";
            },
          },
          {
            title: t("table.actions", "Actions"),
            fixed: "right" as const,
            width: 160,
            render: (_, record) => (
              <Space>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openEditForm(record)}
                />
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  title="New child item"
                  onClick={() => openChildTask(record)}
                />
                <Button
                  size="small"
                  icon={<BulbOutlined />}
                  title="Alignment View"
                  onClick={() => openAlignmentView(record)}
                />
              </Space>
            ),
          },
          {
            title: t("table.advance", "Advance"),
            fixed: "right" as const,
            width: 80,
            render: (_, record) => (
              <Checkbox
                onChange={async () => {
                  const nextState = advanceState(record.state);
                  setLoading(true);
                  try {
                    await api.updateTodo(record.projectId, record.id, { state: nextState });
                    message.success(`Moved to ${nextState}`);
                    await loadTodos({ ...filters, page: pagination.current, pageSize: pagination.pageSize }, tabKey);
                  } catch (err: any) {
                    message.error(err.message || "Failed to update state");
                  } finally {
                    setLoading(false);
                  }
                }}
              />
            ),
          },
        ]}
        />
      )}

        </Card>
      )}
      <Drawer
        title={editing ? t("drawer.title.edit", "Edit To-Do") : t("drawer.title.create", "Create To-Do")}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditing(null);
          setComments([]);
        }}
        width={1200}
        destroyOnClose
        extra={
          <Space>
            {editing && organization && (
              <Button
                icon={<LinkOutlined />}
                type="default"
                onClick={() => {
                  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(
                    editing.projectName || editing.projectId || ""
                  )}/_workitems/edit/${editing.id}`;
                  window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                {t("drawer.buttons.viewDevOps", "View in DevOps")}
              </Button>
            )}
            <Button
              onClick={() => {
                setDrawerOpen(false);
                setEditing(null);
                setComments([]);
              }}
            >
              {t("drawer.buttons.cancel", "Cancel")}
            </Button>
            <Button loading={loading} onClick={() => handleCreate({ temporary: true })}>
              {t("drawer.buttons.temporarySave", "Temporary Save")}
            </Button>
            <Button type="primary" loading={loading} onClick={() => handleCreate()}>
              {editing ? t("drawer.buttons.save", "Save") : t("drawer.buttons.create", "Create")}
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" form={form} initialValues={{ state: "New", workItemType: "User Story" }}>
          <Form.Item label={t("form.fields.project", "Project")} name="projectId" rules={[{ required: true }]}> 
            <Select
              placeholder={t("form.placeholders.project", "Select project")}
              options={projects}
              showSearch
              disabled={!!editing || !!forcedProjectId}
              onChange={(val) => {
                loadTags(val);
                loadAreas(val);
                loadIterations(val);
                loadParents(val);
                setComments([]);
              }}
            />
          </Form.Item>
          <Form.Item label={t("form.fields.title", "Title")} name="title" rules={[{ required: true }]}>
            <Input style={{ borderRadius: 0 }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("form.fields.workItemType", "Work Item Type")} name="workItemType">
                <Select
                  disabled={!!editing}
                  options={["User Story", "Product Backlog Item", "Task", "Bug", "Feature"].map((v) => ({
                    label: v,
                    value: v,
                  }))}
                  placeholder={t("form.placeholders.workItemType", "Select type")}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("form.fields.parent", "Parent")} name="parentId">
                <Select
                  showSearch
                  allowClear
                  options={parentOptions}
                  placeholder={t("form.placeholders.parent", "Select parent")}
                  onFocus={() => loadParents(form.getFieldValue("projectId"))}
                  onSearch={(val) =>
                    debounce(parentSearchTimeout, () => loadParents(form.getFieldValue("projectId"), val))
                  }
                  filterOption={false}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("form.fields.assignedTo", "Assigned To")} name="assignedTo">
                <Input style={{ borderRadius: 0 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("form.fields.state", "State")} name="state">
                <Select
                  options={["New", "Active", "Resolved", "Closed"].map((value) => ({
                    label: value,
                    value,
                  }))}
                  placeholder={t("form.placeholders.state", "Select state")}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("form.fields.priority", "Priority")} name="priority">
                <Select
                  options={[1, 2, 3, 4].map((v) => ({ label: `P${v}`, value: v }))}
                  placeholder={t("form.placeholders.priority", "Select priority")}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("form.fields.originalEstimate", "Original Estimate")} name="originalEstimate">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("form.fields.plannedStart", "Planned Start Date")} name="plannedStartDate">
                <DatePicker style={{ width: "100%" }} allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("form.fields.targetDate", "Target Date")} name="targetDate">
                <DatePicker style={{ width: "100%" }} allowClear />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={t("form.fields.description", "Description")} name="description">
            <RichTextEditor
              value={form.getFieldValue("description")}
              onChange={(html) => form.setFieldsValue({ description: html })}
              placeholder={t("form.placeholders.description", "Rich text: paste images, add links")}
              onUploadImage={async (file) => {
                const projectId = form.getFieldValue("projectId");
                if (!projectId) {
                  message.error(t("form.messages.selectProjectFirst", "Please select project first"));
                  throw new Error("projectId required");
                }
                const res = await api.uploadAttachment(projectId, file);
                return res.url;
              }}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label={t("form.fields.area", "Area")} name="areaPath">
                <Select
                  showSearch
                  options={areaOptions}
                  placeholder={t("form.placeholders.area", "Select area")}
                  onFocus={() => loadAreas(form.getFieldValue("projectId"))}
                  onSearch={(val) =>
                    debounce(areaSearchTimeout, () => loadAreas(form.getFieldValue("projectId"), val))
                  }
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t("form.fields.iteration", "Iteration")} name="iterationPath">
                <Select
                  showSearch
                  options={iterationOptions}
                  placeholder={t("form.placeholders.iteration", "Select iteration")}
                  onFocus={() => loadIterations(form.getFieldValue("projectId"))}
                  onSearch={(val) =>
                    debounce(iterationSearchTimeout, () => loadIterations(form.getFieldValue("projectId"), val))
                  }
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={t("form.fields.tags", "Tags")} name="tags">
            <Select
              mode="tags"
              options={tagOptions}
              showSearch
              placeholder={t("form.placeholders.tags", "Add tags")}
              onFocus={() => loadTags(form.getFieldValue("projectId"))}
              onSearch={(val) => debounce(tagSearchTimeout, () => loadTags(form.getFieldValue("projectId"), val))}
            />
          </Form.Item>
          {editing && (
            <>
              <Form.Item label={t("form.fields.addComment", "Add Comment")}>
                <RichTextEditor
                  ref={commentEditorRef}
                  value={newComment}
                  onChange={(html) => setNewComment(html)}
                  placeholder={t("form.placeholders.comment", "Add a comment")}
                  onUploadImage={async (file) => {
                    if (!editing?.projectId) {
                      message.error(t("form.messages.selectProjectFirst", "Please select project first"));
                      throw new Error("projectId required");
                    }
                    const res = await api.uploadAttachment(editing.projectId, file);
                    return res.url;
                  }}
                />
                <Space style={{ marginTop: 8 }} wrap>
                  <Dropdown
                    trigger={["click"]}
                    open={mentionPickerOpen}
                    onOpenChange={(open) => {
                      setMentionPickerOpen(open);
                      if (!open) {
                        setMentionSearchValue("");
                       setMentionOptions([]);
                     }
                   }}
                   dropdownRender={() => (
                     <div style={{ padding: 12, width: 280 }}>
                       <AutoComplete
                         autoFocus
                         value={mentionSearchValue}
                          placeholder={t("form.placeholders.searchUsers", "Search users")}
                          style={{ width: "100%" }}
                          options={mentionOptions.map((opt) => ({ label: opt.label, value: opt.value }))}
                          onChange={(val) => setMentionSearchValue(val)}
                          onSearch={(val) => {
                            setMentionSearchValue(val);
                            debounce(mentionSearchTimeout, () => fetchMentionOptions(val));
                          }}
                          onSelect={(value) => {
                            const target = mentionOptions.find((opt) => opt.value === value);
                            if (target) {
                              insertMention(target.identity);
                            }
                          }}
                          onBlur={() => setMentionPickerOpen(false)}
                          notFoundContent={mentionLoading ? t("form.text.searching", "Searching...") : t("form.text.noMatches", "No matches")}
                        />
                      </div>
                    )}
                  >
                    <Button icon={<UserAddOutlined />}>{t("form.buttons.mention", "@ Mention")}</Button>
                  </Dropdown>
                  <Button
                    type="primary"
                    onClick={async () => {
                      const content = (newComment || "").trim();
                      if (!hasRichContent(content)) {
                        message.warning(t("form.messages.emptyComment", "Comment is empty"));
                        return;
                      }
                      await handleAddComment(content);
                      setNewComment("");
                    }}
                    disabled={!hasRichContent(newComment)}
                    loading={commentLoading}
                  >
                    {t("form.buttons.post", "Post")}
                  </Button>
                </Space>
              </Form.Item>
              <Form.Item label={t("form.fields.discussion", "Discussion")}>
                <div className="discussion-timeline">
                  {commentLoading ? (
                    t("form.text.loading", "Loading...")
                  ) : comments.length ? (
                    comments.map((c, index) => (
                      <div key={c.id || index} className="discussion-item">
                        <div className="discussion-meta">
                          <div className="discussion-author">{c.createdBy || "Unknown"}</div>
                          <div className="discussion-date">{c.createdDate ? new Date(c.createdDate).toLocaleString() : ""}</div>
                        </div>
                        <div
                          className="rich-text-preview"
                          // Azure DevOps comment text already comes as HTML; render it to keep formatting/images.
                          dangerouslySetInnerHTML={{ __html: rewriteAzureAttachmentHtml(c.text || "") }}
                        />
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#999" }}>{t("form.text.noComments", "No comments")}</div>
                  )}
                </div>
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
    </>
  );
}
