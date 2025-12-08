import { EditOutlined, LinkOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tag, Tabs, Typography, message, Checkbox } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";

import { api, API_BASE } from "../api";
import { RichTextEditor } from "../components/RichTextEditor";

const typeColors: Record<string, string> = {
  Epic: "magenta",
  Feature: "gold",
  "User Story": "purple",
  "Product Backlog Item": "green",
  Task: "blue",
  Bug: "red",
};

const ALL_WORK_ITEM_TYPES = ["Epic", "Feature", "User Story", "Product Backlog Item", "Task", "Bug"];
const DEFAULT_WORK_ITEM_TYPES = ALL_WORK_ITEM_TYPES.filter((t) => t !== "Epic");
const NO_EPIC_SENTINEL = "__NO_EPIC__";

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

const hasRichContent = (html: string): boolean => {
  if (!html) return false;
  const text = html.replace(/<[^>]*>/g, "").trim();
  if (text.length > 0) return true;
  return /<(img|video|audio|iframe|embed|object)\b/i.test(html);
};

const priorityTokenStyle = (value: number | string | undefined) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { background: "#f5f5f5", color: "#595959", border: "1px solid #d9d9d9" };
  }
  if (n === 1) {
    return { background: "#ffe7e6", color: "#cf1322", border: "none" };
  }
  if (n === 2) {
    return { background: "#fff7e6", color: "#d48806", border: "none" };
  }
  if (n === 3) {
    return { background: "#e6f4ff", color: "#1677ff", border: "none" };
  }
  // 4 or others: neutral
  return { background: "#f5f5f5", color: "#595959", border: "1px solid #d9d9d9" };
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

export function AllTodosPage() {
  const FILTER_STORAGE_KEY = "allTodosFilters";
  const [todos, setTodos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{
    state?: string;
    keyword?: string;
    assignedTo?: string;
    type?: string;
    project?: string; // projectId
    page?: number;
    pageSize?: number;
    closedFrom?: string;
    closedTo?: string;
  }>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
        if (raw) {
          const stored = JSON.parse(raw) as {
            state?: string;
            keyword?: string;
            assignedTo?: string;
            type?: string;
            project?: string;
            closedFrom?: string;
            closedTo?: string;
          };
          const type = stored.type || NO_EPIC_SENTINEL;
          return { ...stored, type, page: 1, pageSize: 20 };
        }
      } catch {
        // ignore parse errors
      }
    }
    // 默认：过滤掉 Epic（使用后端约定的哨兵值）
    return { page: 1, pageSize: 20, type: NO_EPIC_SENTINEL };
  });
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [projects, setProjects] = useState<{ label: string; value: string }[]>([]);
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);
  const [areaOptions, setAreaOptions] = useState<{ label: string; value: string }[]>([]);
  const [iterationOptions, setIterationOptions] = useState<{ label: string; value: string }[]>([]);
  const [parentOptions, setParentOptions] = useState<{ label: string; value: number }[]>([]);
  const [form] = Form.useForm();
  const [tabKey, setTabKey] = useState<"all" | "no-start" | "on-going" | "completed">("on-going");
  const [comments, setComments] = useState<any[]>([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [organization, setOrganization] = useState("");

  const advanceState = (state?: string) => {
    const normalized = (state || "").toLowerCase();
    if (normalized === "new") return "Active";
    if (normalized === "active" || normalized === "validate") return "Closed";
    return "Closed";
  };

  const loadTodos = async (nextFilters = filters, tabOverride?: string) => {
    const currentTab = tabOverride || tabKey;
    let stateFilter = nextFilters.state;
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
    setLoading(true);
    try {
      const res = await api.listAllTodos({ ...nextFilters, state: stateFilter });
      const raw = res.todos || [];
      const filteredByState =
        allowedStates.length === 0
          ? raw
          : raw.filter((t) => {
              const s = (t.state || "").toString().trim().toLowerCase();
              return allowedStates.includes(s);
            });
      const projectFilter = nextFilters.project;
      let filtered =
        projectFilter && projectFilter.length > 0
          ? filteredByState.filter((t) => String(t.projectId || "").toString() === projectFilter)
          : filteredByState;

      if (currentTab === "completed" && (nextFilters.closedFrom || nextFilters.closedTo)) {
        const from = nextFilters.closedFrom ? new Date(nextFilters.closedFrom) : undefined;
        const to = nextFilters.closedTo ? new Date(nextFilters.closedTo) : undefined;
        filtered = filtered.filter((t) => {
          const raw = (t as any).closedDate || (t as any).createdDate;
          if (!raw) return false;
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) return false;
          if (from && d < from) return false;
          if (to && d > to) return false;
          return true;
        });
      }

      setTodos(filtered);
      const page = nextFilters.page || 1;
      const pageSize = nextFilters.pageSize || 20;
      const hasMore = res.hasMore;
      const total = hasMore ? page * pageSize + 1 : (page - 1) * pageSize + (filtered.length || 0);
      setPagination({ current: page, pageSize, total });
    } catch (err: any) {
      message.error(err.message || "Failed to load to-dos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 初次加载时根据当前 tabKey 应用状态筛选；
    // 这里默认 tabKey 为 "on-going"，所以默认查看 On-Going。
    loadTodos(filters, tabKey);
    api
      .session()
      .then((res) => setOrganization(res.organization || ""))
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

  const persistFilters = (next: typeof filters) => {
    if (typeof window === "undefined") return;
    try {
      const { page, pageSize, ...rest } = next;
      window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(rest));
    } catch {
      // ignore quota errors
    }
  };

  const applyKeywordSearch = (raw: string | undefined): typeof filters => {
    const text = raw?.trim();
    if (!text) {
      const next = { ...filters, keyword: undefined, page: 1 };
      setFilters(next);
      persistFilters(next);
      return next;
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
      const next = {
        ...filters,
        keyword: rest || undefined,
        type: mappedType || filters.type,
        page: 1,
      };
      setFilters(next);
      persistFilters(next);
      return next;
    }

    const next = { ...filters, keyword: text, page: 1 };
    setFilters(next);
    persistFilters(next);
    return next;
  };

  const applyClosedRangeShortcut = (range: { from: string; to: string }) => {
    const next = {
      ...filters,
      closedFrom: range.from,
      closedTo: range.to,
      page: 1,
    };
    setFilters(next);
    persistFilters(next);
    loadTodos(next, "completed");
  };

  const totalRemaining = useMemo(
    () =>
      todos.reduce((sum, item) => {
        const v = (item as any).originalEstimate;
        const n = typeof v === "number" ? v : v ? Number(v) : 0;
        return sum + (isNaN(n) ? 0 : n);
      }, 0),
    [todos]
  );

  const remainingByProject = useMemo(() => {
    const map: Record<string, number> = {};
    todos.forEach((item) => {
      const key = (item.projectName || item.project || "Unknown").toString();
      const v = (item as any).originalEstimate;
      const n = typeof v === "number" ? v : v ? Number(v) : 0;
      if (!isNaN(n)) {
        map[key] = (map[key] || 0) + n;
      }
    });
    return map;
  }, [todos]);

  const openChildTask = (record: any) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      projectId: record.projectId,
      title: "",
      assignedTo: record.assignedTo,
      state: "New",
      priority: 2,
      originalEstimate: undefined,
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

  const handlePageChange = (page: number, pageSize?: number) => {
    const next = { ...filters, page, pageSize: pageSize || filters.pageSize };
    setFilters(next);
    loadTodos(next);
  };

  const handleTabChange = (key: string) => {
    setTabKey(key);
    const next = { ...filters, page: 1 };
    if (key === "no-start") {
      next.state = "New";
    } else if (key === "on-going") {
      next.state = undefined;
    } else if (key === "completed") {
      next.state = undefined;
      if (!next.closedFrom && !next.closedTo) {
        const range = getCurrentWeekRange();
        next.closedFrom = range.from;
        next.closedTo = range.to;
      }
    } else {
      next.state = filters.state;
    }
    setFilters(next);
    loadTodos(next, key);
  };

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

  const handleCreate = async () => {
    const values = await form.validateFields();
    const cleanArea = typeof values.areaPath === "string" ? values.areaPath.replace(/^[/\\]+/, "") : values.areaPath;
    const cleanIteration =
      typeof values.iterationPath === "string" ? values.iterationPath.replace(/^[/\\]+/, "") : values.iterationPath;
    const parentId =
      values.parentId !== undefined && values.parentId !== null ? Number(values.parentId) : null;
    const originalEstimate = values.originalEstimate;
    const desiredState = values.state || "New";
    const stateLower = desiredState.toString().toLowerCase();
    const isClosed = stateLower === "closed" || stateLower === "resolved";
    let remainingValue = values.remaining;
    if (remainingValue == null && originalEstimate != null && !isClosed) {
      // 非关闭状态下，如果没单独填 Remaining，则默认与 Original Estimate 相同
      remainingValue = originalEstimate;
    }
    try {
      setLoading(true);
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
        // 编辑已关闭的 item 时，不再自动改写 Remaining
        if (!isClosed && remainingValue != null) {
          updatePayload.remaining = remainingValue;
        }
        await api.updateTodo(values.projectId, editing.id, updatePayload);
        message.success("Updated");
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
        });
        if (isClosed && created?.todo?.id) {
          await api.updateTodo(values.projectId, created.todo.id, { state: desiredState });
        }
        message.success("Created");
      }
      await loadTodos(
        { ...filters, page: pagination.current, pageSize: pagination.pageSize },
        tabKey
      );
      setDrawerOpen(false);
      setEditing(null);
      form.resetFields();
    } catch (err: any) {
      message.error(err.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="All Projects - To-Dos"
      extra={
        <Space align="center" size={24}>
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary">
              总工时: <span style={{ fontWeight: 600 }}>{totalRemaining}</span>
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {Object.entries(remainingByProject)
                .map(([name, hours]) => `${name}: ${hours}`)
                .join(" | ")}
            </Typography.Text>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={() => loadTodos()}>
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              form.resetFields();
              setDrawerOpen(true);
            }}
          >
            New To-Do
          </Button>
        </Space>
      }
    >
      <Tabs
        activeKey={tabKey}
        onChange={handleTabChange}
        items={[
          { key: "all", label: "All" },
          { key: "no-start", label: "No-Start" },
          { key: "on-going", label: "On-Going" },
          { key: "completed", label: "Completed" },
        ]}
        style={{ marginBottom: 12 }}
      />
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}>
          <Input
            placeholder="Search title"
            allowClear
            onChange={(e) => {
              const next = applyKeywordSearch(e.target.value || undefined);
              loadTodos(next);
            }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Input
            placeholder="Assigned to"
            allowClear
            value={filters.assignedTo}
            onChange={(e) => {
              const next = { ...filters, assignedTo: e.target.value || undefined, page: 1 };
              setFilters(next);
              persistFilters(next);
              loadTodos(next);
            }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Select
            allowClear
            placeholder="State"
            style={{ width: "100%" }}
            disabled={tabKey !== "all"}
            onChange={(value) => {
              const next = { ...filters, state: value || undefined, page: 1 };
              setFilters(next);
              persistFilters(next);
              loadTodos(next);
            }}
            options={["New", "Active", "Resolved", "Closed", "Removed"].map((value) => ({
              label: value,
              value,
            }))}
          />
        </Col>
        <Col xs={24} md={6}>
          <Select
            mode="multiple"
            allowClear
            placeholder="Work item type"
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
              setFilters(next);
              persistFilters(next);
              loadTodos(next);
            }}
            options={ALL_WORK_ITEM_TYPES.map((value) => ({
              label: value,
              value,
            }))}
          />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}>
          <Select
            allowClear
            showSearch
            placeholder="Project"
            style={{ width: "100%" }}
            value={filters.project}
            options={projects}
            optionFilterProp="label"
            onChange={(value) => {
              const next = { ...filters, project: value || undefined, page: 1 };
              setFilters(next);
              persistFilters(next);
              loadTodos(next);
            }}
          />
        </Col>
        {tabKey === "completed" && (
          <>
            <Col xs={24} md={8}>
              <DatePicker.RangePicker
                style={{ width: "100%" }}
                placeholder={["Closed from", "Closed to"]}
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
                  setFilters(next);
                  persistFilters(next);
                  loadTodos(next, "completed");
                }}
              />
            </Col>
            <Col xs={24} md={10}>
              <Space wrap>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getRelativeWeekRange(0))}>
                  本周
                </Button>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getRelativeWeekRange(-1))}>
                  上周
                </Button>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getRelativeWeekRange(-2))}>
                  上上周
                </Button>
                <Button size="small" onClick={() => applyClosedRangeShortcut(getCurrentMonthRange())}>
                  本月
                </Button>
              </Space>
            </Col>
          </>
        )}
      </Row>

      <Table<any>
        dataSource={todos}
        loading={loading}
        rowKey={(row) => `${row.projectId}-${row.id}`}
       onRow={(record) => ({
         onDoubleClick: () => {
            setEditing(record);
            form.setFieldsValue({
              projectId: record.projectId,
              title: record.title,
              assignedTo: record.assignedTo,
              priority: record.priority,
              originalEstimate: (record as any).originalEstimate,
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
         },
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          onChange: handlePageChange,
        }}
        columns={[
          { title: "Project", dataIndex: "projectName" },
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "Title", dataIndex: "title", ellipsis: true, width: 320 },
          {
            title: "Type",
            dataIndex: "workItemType",
            render: (value?: string) => (value ? <Tag color={typeColors[value] || "default"}>{value}</Tag> : "-"),
          },
          { title: "State", dataIndex: "state" },
          {
            title: "Priority",
            dataIndex: "priority",
            width: 90,
            render: (value: number) => {
              const display = value != null && value !== undefined ? value : "-";
              const style = priorityTokenStyle(value);
              return (
                <span
                  style={{
                    display: "inline-block",
                    minWidth: 28,
                    padding: "0 8px",
                    textAlign: "center",
                    borderRadius: 12,
                    fontSize: 12,
                    lineHeight: "20px",
                    backgroundColor: style.background,
                    color: style.color,
                    border: style.border,
                  }}
                >
                  {display}
                </span>
              );
            },
          },
          {
            title: "Original Estimate",
            dataIndex: "originalEstimate",
            width: 130,
            render: (_: any, record: any) => {
              const v = record.originalEstimate;
              return v != null && v !== undefined && v !== "" ? v : "-";
            },
          },
          { title: "Assigned To", dataIndex: "assignedTo" },
          { title: "Area", dataIndex: "areaPath", ellipsis: true },
          { title: "Iteration", dataIndex: "iterationPath", ellipsis: true },
          {
            title: "Tags",
            dataIndex: "tags",
            render: (tags?: string[]) =>
              tags?.length ? (
                <Space size={[0, 4]} wrap>
                  {tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              ) : (
                "-"
              ),
          },
          {
            title: "Last Changed",
            dataIndex: "changedDate",
            render: (value: string) => (value ? new Date(value).toLocaleString() : "-"),
          },
          {
            title: tabKey === "completed" ? "Closed" : "Created",
            dataIndex: tabKey === "completed" ? "closedDate" : "createdDate",
            render: (_: any, record: any) => {
              const raw = tabKey === "completed" ? record.closedDate || record.createdDate : record.createdDate;
              return raw ? new Date(raw).toLocaleString() : "-";
            },
          },
          {
            title: "Actions",
            render: (_, record) => (
              <Space>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue({
                      projectId: record.projectId,
                      title: record.title,
                      assignedTo: record.assignedTo,
                      priority: record.priority,
                      originalEstimate: (record as any).originalEstimate,
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
                  }}
                />
                {record.workItemType === "User Story" && (
                  <Button
                    size="small"
                    icon={<PlusOutlined />}
                    title="New Task under this User Story"
                    onClick={() => openChildTask(record)}
                  />
                )}
              </Space>
            ),
          },
          {
            title: "Advance",
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

      <Drawer
        title={editing ? "Edit To-Do" : "Create To-Do"}
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
                View in DevOps
              </Button>
            )}
            <Button
              onClick={() => {
                setDrawerOpen(false);
                setEditing(null);
                setComments([]);
              }}
            >
              Cancel
            </Button>
            <Button type="primary" loading={loading} onClick={handleCreate}>
              {editing ? "Save" : "Create"}
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" form={form} initialValues={{ state: "New", assignedTo: "Evan Zhu", workItemType: "User Story" }}>
          <Form.Item label="Project" name="projectId" rules={[{ required: true }]}>
            <Select
              placeholder="Select project"
              options={projects}
              showSearch
              disabled={!!editing}
              onChange={(val) => {
                loadTags(val);
                loadAreas(val);
                loadIterations(val);
                loadParents(val);
                setComments([]);
              }}
            />
          </Form.Item>
          <Form.Item label="Title" name="title" rules={[{ required: true }]}>
            <Input style={{ borderRadius: 0 }} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Work Item Type" name="workItemType">
                <Select
                  disabled={!!editing}
                  options={["User Story", "Product Backlog Item", "Task", "Bug", "Feature"].map((v) => ({
                    label: v,
                    value: v,
                  }))}
                  placeholder="Select type"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Parent" name="parentId">
                <Select
                  showSearch
                  allowClear
                  options={parentOptions}
                  placeholder="Select parent"
                  onFocus={() => loadParents(form.getFieldValue("projectId"))}
                  onSearch={(val) => loadParents(form.getFieldValue("projectId"), val)}
                  filterOption={false}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Assigned To" name="assignedTo">
                <Input style={{ borderRadius: 0 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="State" name="state">
                <Select
                  options={["New", "Active", "Resolved", "Closed"].map((value) => ({
                    label: value,
                    value,
                  }))}
                  placeholder="Select state"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Priority" name="priority">
                <Select
                  options={[1, 2, 3, 4].map((v) => ({ label: `P${v}`, value: v }))}
                  placeholder="Select priority"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Original Estimate" name="originalEstimate">
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Description" name="description">
            <RichTextEditor
              value={form.getFieldValue("description")}
              onChange={(html) => form.setFieldsValue({ description: html })}
              placeholder="Rich text: paste images, add links"
              onUploadImage={async (file) => {
                const projectId = form.getFieldValue("projectId");
                if (!projectId) {
                  message.error("Please select project first");
                  throw new Error("projectId required");
                }
                const res = await api.uploadAttachment(projectId, file);
                return res.url;
              }}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Area" name="areaPath">
                <Select
                  showSearch
                  options={areaOptions}
                  placeholder="Select area"
                  onFocus={() => loadAreas(form.getFieldValue("projectId"))}
                  onSearch={(val) => loadAreas(form.getFieldValue("projectId"), val)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Iteration" name="iterationPath">
                <Select
                  showSearch
                  options={iterationOptions}
                  placeholder="Select iteration"
                  onFocus={() => loadIterations(form.getFieldValue("projectId"))}
                  onSearch={(val) => loadIterations(form.getFieldValue("projectId"), val)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Tags" name="tags">
            <Select
              mode="tags"
              options={tagOptions}
              showSearch
              placeholder="Add tags"
              onFocus={() => loadTags(form.getFieldValue("projectId"))}
              onSearch={(val) => loadTags(form.getFieldValue("projectId"), val)}
            />
          </Form.Item>
          {editing && (
            <>
              <Form.Item label="Add Comment">
                <RichTextEditor
                  value={newComment}
                  onChange={(html) => setNewComment(html)}
                  placeholder="Add a comment"
                  onUploadImage={async (file) => {
                    if (!editing?.projectId) {
                      message.error("Please select project first");
                      throw new Error("projectId required");
                    }
                    const res = await api.uploadAttachment(editing.projectId, file);
                    return res.url;
                  }}
                />
                <Button
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    const content = (newComment || "").trim();
                    if (!hasRichContent(content)) {
                      message.warning("Comment is empty");
                      return;
                    }
                    await handleAddComment(content);
                    setNewComment("");
                  }}
                  disabled={!hasRichContent(newComment)}
                >
                  Post
                </Button>
              </Form.Item>
              <Form.Item label="Discussion">
                <div className="discussion-timeline">
                  {commentLoading ? (
                    "Loading..."
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
                    <div style={{ color: "#999" }}>No comments</div>
                  )}
                </div>
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
    </Card>
  );
}
