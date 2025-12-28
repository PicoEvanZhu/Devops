import { ArrowRightOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Card, Col, Empty, Progress, Row, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import { useI18n } from "../i18n";
import type { Project, SessionInfo, TodoItem } from "../types";

type DashboardSummary = {
  total: number;
  todo: number;
  active: number;
  done: number;
  overdue: number;
};

const normalizeState = (state?: string) => (state || "").toLowerCase().trim();

const getTodoStatusTone = (state?: string) => {
  const normalized = normalizeState(state);
  if (normalized === "closed" || normalized === "resolved") return "green";
  if (normalized === "active" || normalized === "validate") return "blue";
  if (normalized === "new") return "gold";
  return "default";
};

const computeProgress = (todo: TodoItem) => {
  if (typeof todo.remaining === "number" && typeof todo.originalEstimate === "number" && todo.originalEstimate > 0) {
    const progress = Math.round((1 - todo.remaining / todo.originalEstimate) * 100);
    return Math.min(100, Math.max(0, progress));
  }
  const normalized = normalizeState(todo.state);
  if (normalized === "closed" || normalized === "resolved") return 100;
  if (normalized === "active" || normalized === "validate") return 70;
  if (normalized === "new") return 25;
  return 45;
};

export function ProjectsPage({ session }: { session: SessionInfo }) {
  const [sessionFromServer, setSessionFromServer] = useState<SessionInfo | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary>({
    total: 0,
    todo: 0,
    active: 0,
    done: 0,
    overdue: 0,
  });
  const [ownerFilter, setOwnerFilter] = useState("");
  const [ownerInput, setOwnerInput] = useState("");
  const OWNER_FILTER_STORAGE_KEY = "dashboardOwnerFilter";
  const [ownerOptions, setOwnerOptions] = useState<{ value: string; label: string }[]>([]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const ownerSearchTimeout = useRef<number | null>(null);
  const [userProjectIds, setUserProjectIds] = useState<string[]>([]);
  const [myTodos, setMyTodos] = useState<TodoItem[]>([]);
  const [objectives, setObjectives] = useState<TodoItem[]>([]);
  const navigate = useNavigate();
  const { t } = useI18n();

  const effectiveSession = sessionFromServer?.authenticated ? sessionFromServer : session;
  const displayName =
    effectiveSession.user?.displayName || effectiveSession.user?.email || t("dashboard.fallbackName", "伙伴");
  const userTokens = useMemo(() => {
    const tokens = [
      effectiveSession.user?.displayName,
      effectiveSession.user?.email,
      effectiveSession.user?.uniqueName,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    return Array.from(new Set(tokens));
  }, [effectiveSession.user?.displayName, effectiveSession.user?.email, effectiveSession.user?.uniqueName]);

  const activeOwner =
    ownerFilter ||
    effectiveSession.user?.email ||
    effectiveSession.user?.uniqueName ||
    effectiveSession.user?.displayName ||
    "";
  const activeOwnerTokens = activeOwner ? [activeOwner.toLowerCase()] : userTokens;

  const isOwnedByUser = (item: TodoItem) => {
    if (activeOwnerTokens.length === 0) return false;
    const assigned = (item.assignedTo || "").toLowerCase();
    return activeOwnerTokens.some((token) => assigned.includes(token) || token.includes(assigned));
  };

  const loadDashboard = async () => {
    setDashboardLoading(true);
    try {
      const assignedTo = activeOwner || "";
      const res = await api.listAllTodos({ pageSize: 1000, assignedTo: assignedTo || undefined });
      const items = res.todos || [];
      const ownedItems = activeOwner ? items : items.filter(isOwnedByUser);
      const counts = ownedItems.reduce(
        (acc, item) => {
          const state = normalizeState(item.state);
          acc.total += 1;
          if (state === "new") acc.todo += 1;
          else if (state === "active" || state === "validate") acc.active += 1;
          else if (state === "closed" || state === "resolved") acc.done += 1;
          return acc;
        },
        { total: 0, todo: 0, active: 0, done: 0 }
      );
      const now = dayjs();
      const overdueCount = ownedItems.filter((item) => {
        const state = normalizeState(item.state);
        if (state === "closed" || state === "resolved") return false;
        if (!item.targetDate) return false;
        return dayjs(item.targetDate).isBefore(now, "day");
      }).length;

      const mine = [...ownedItems]
        .sort((a, b) => {
          const dateA = dayjs(a.changedDate || a.createdDate || 0).valueOf();
          const dateB = dayjs(b.changedDate || b.createdDate || 0).valueOf();
          return dateB - dateA;
        })
        .slice(0, 3);


      const objectiveCandidates = ownedItems.filter((item) =>
        ["epic", "feature"].includes((item.workItemType || "").toLowerCase())
      );
      const objectiveList = (objectiveCandidates.length > 0 ? objectiveCandidates : ownedItems)
        .slice(0, 3);

      setSummary({ ...counts, overdue: overdueCount });
      setMyTodos(mine);
      setObjectives(objectiveList);
      const projectIds = Array.from(
        new Set(
          ownedItems
            .map((item) => (item.projectId ? String(item.projectId).trim() : ""))
            .filter((value) => value.length > 0)
        )
      );
      setUserProjectIds(projectIds);
    } catch (err: any) {
      message.error(err.message || "Failed to fetch dashboard data");
    } finally {
      setDashboardLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listProjects();
      setProjects(res.projects || []);
    } catch (err: any) {
      message.error(err.message || "Failed to fetch projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadDashboard();
  }, []);

  useEffect(() => {
    api
      .session()
      .then((res) => {
        if (res.authenticated) {
          setSessionFromServer(res);
        }
      })
      .catch(() => void 0);
  }, []);

  useEffect(() => {
    if (!ownerFilter) {
      let cachedOwner = "";
      if (typeof window !== "undefined") {
        cachedOwner = window.localStorage.getItem(OWNER_FILTER_STORAGE_KEY) || "";
      }
      const defaultOwner =
        cachedOwner ||
        effectiveSession.user?.email ||
        effectiveSession.user?.uniqueName ||
        effectiveSession.user?.displayName;
      if (defaultOwner) {
        setOwnerFilter(defaultOwner);
        setOwnerInput(defaultOwner);
      }
    }
  }, [
    ownerFilter,
    effectiveSession.user?.displayName,
    effectiveSession.user?.email,
    effectiveSession.user?.uniqueName,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (ownerFilter) {
      window.localStorage.setItem(OWNER_FILTER_STORAGE_KEY, ownerFilter);
    } else {
      window.localStorage.removeItem(OWNER_FILTER_STORAGE_KEY);
    }
  }, [ownerFilter]);

  useEffect(() => {
    loadDashboard();
  }, [ownerFilter, userTokens.length]);

  const handleOwnerSearch = (value: string) => {
    if (ownerSearchTimeout.current) {
      window.clearTimeout(ownerSearchTimeout.current);
    }
    if (!value || value.trim().length < 2) {
      setOwnerOptions([]);
      return;
    }
    ownerSearchTimeout.current = window.setTimeout(async () => {
      setOwnerLoading(true);
      try {
        const res = await api.searchIdentities(value.trim());
        const options = (res.identities || []).map((identity) => ({
          value: identity.mail || identity.uniqueName || identity.displayName || identity.id || value,
          label: identity.displayName
            ? `${identity.displayName}${identity.mail ? ` (${identity.mail})` : ""}`
            : identity.mail || identity.uniqueName || identity.id || value,
        }));
        setOwnerOptions(options);
      } catch (err: any) {
        message.error(err.message || "Failed to search owners");
      } finally {
        setOwnerLoading(false);
      }
    }, 300) as unknown as number;
  };

  const filteredProjects = useMemo(() => {
    if (!activeOwner) return projects;
    if (userProjectIds.length === 0) return [];
    return projects.filter((project) => userProjectIds.includes(project.id));
  }, [projects, userProjectIds, activeOwner]);

  const metricCards = useMemo(
    () => [
      { label: t("dashboard.metrics.todo", "待办"), value: summary.todo, tone: "todo" },
      { label: t("dashboard.metrics.active", "进行中"), value: summary.active, tone: "active" },
      { label: t("dashboard.metrics.done", "已完成"), value: summary.done, tone: "done" },
      { label: t("dashboard.metrics.overdue", "逾期"), value: summary.overdue, tone: "overdue" },
    ],
    [summary, t]
  );


  return (
    <div className="dashboard">
      <Card className="dashboard-hero" bordered={false}>
        <div className="dashboard-hero-content">
          <div>
            <Typography.Title level={2} className="dashboard-hero-title">
              {t("dashboard.welcome", "欢迎回来")}，{displayName}
            </Typography.Title>
            <Typography.Text className="dashboard-hero-sub">
              {t("dashboard.subtitle", "今天也要稳步推进你的目标")}
            </Typography.Text>
            <div className="dashboard-hero-quote">
              <Typography.Text>
                {t("dashboard.quote.line1", "希望我们见证彼此的成长，互助前行。")}
              </Typography.Text>
              <Typography.Text>
                {t("dashboard.quote.line2", "所有的目标，都是经过分解，逐步实现才能达成。")}
              </Typography.Text>
            </div>
          </div>
          <div className="dashboard-hero-badge">
            <span>{t("dashboard.heroBadge", "每日节奏")}</span>
            <strong>{dayjs().format("MM/DD")}</strong>
          </div>
        </div>
      </Card>

      <div className="dashboard-filter">
        <Typography.Text className="dashboard-filter-label">
          {t("dashboard.ownerFilter", "负责人")}
        </Typography.Text>
        <AutoComplete
          allowClear
          options={ownerOptions}
          value={ownerInput || undefined}
          onChange={(value) => setOwnerInput(value)}
          onSelect={(value) => {
            setOwnerInput(value);
            setOwnerFilter(value);
          }}
          onSearch={handleOwnerSearch}
          placeholder={t("dashboard.ownerPlaceholder", "选择负责人")}
          className="dashboard-filter-input"
          notFoundContent={ownerLoading ? t("dashboard.ownerSearching", "搜索中...") : undefined}
        />
      </div>

      <Row gutter={[20, 20]} className="dashboard-metrics">
        {metricCards.map((metric) => (
          <Col xs={12} md={6} key={metric.label}>
            <Card className={`dashboard-metric-card tone-${metric.tone}`} bordered={false}>
              <Typography.Text className="dashboard-metric-label">{metric.label}</Typography.Text>
              <div className="dashboard-metric-value">{metric.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[20, 20]} className="dashboard-main">
        <Col xs={24} lg={12}>
          <Card
            title={t("dashboard.myTasks", "我负责的任务")}
            extra={
              <Button type="link" onClick={() => navigate("/todos")}>
                {t("dashboard.viewAll", "查看全部")}
              </Button>
            }
            loading={dashboardLoading}
            className="dashboard-panel"
          >
            {myTodos.length === 0 && !dashboardLoading ? (
              <Empty description={t("dashboard.emptyTasks", "暂无分配给你的任务")} />
            ) : (
              <Space direction="vertical" size="middle" className="dashboard-list">
                {myTodos.map((item) => (
                  <div key={item.id} className="dashboard-list-item">
                    <div>
                      <Typography.Text strong>{item.title || t("dashboard.untitled", "未命名任务")}</Typography.Text>
                      <Typography.Text type="secondary" className="dashboard-date">
                        {item.targetDate ? dayjs(item.targetDate).format("YYYY-MM-DD") : t("dashboard.noDate", "未设置时间")}
                      </Typography.Text>
                    </div>
                    <Tag color={getTodoStatusTone(item.state)}>{item.state || t("dashboard.statusUnknown", "未知")}</Tag>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={t("dashboard.objectives", "重要 Objective")}
            extra={
              <Button type="link" onClick={() => navigate("/todos")}>
                {t("dashboard.viewAll", "查看全部")}
              </Button>
            }
            loading={dashboardLoading}
            className="dashboard-panel"
          >
            {objectives.length === 0 && !dashboardLoading ? (
              <Empty description={t("dashboard.emptyObjectives", "暂无关键目标")} />
            ) : (
              <Space direction="vertical" size="middle" className="dashboard-list">
                {objectives.map((item) => {
                  const progress = computeProgress(item);
                  return (
                    <div key={item.id} className="dashboard-list-item">
                      <div>
                        <Typography.Text strong>{item.title || t("dashboard.untitled", "未命名目标")}</Typography.Text>
                        <div className="dashboard-progress-row">
                          <Tag color="green">{item.state || t("dashboard.inProgress", "进行中")}</Tag>
                          <Progress percent={progress} size="small" showInfo={false} />
                          <span className="dashboard-progress-value">{progress}%</span>
                        </div>
                      </div>
                      <Button type="link" onClick={() => navigate("/todos")}>
                        {t("dashboard.enter", "进入")}
                      </Button>
                    </div>
                  );
                })}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card
        title={t("projects.title", "Projects")}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              {t("projects.buttons.refresh", "Refresh")}
            </Button>
            <Button type="primary" onClick={() => navigate("/todos")}>
              {t("projects.buttons.allTodos", "All To-Dos")}
            </Button>
          </Space>
        }
        className="dashboard-panel"
      >
        <Table<Project>
          dataSource={filteredProjects}
          loading={loading}
          rowKey="id"
          pagination={false}
          columns={[
            { title: t("projects.columns.name", "Name"), dataIndex: "name" },
            { title: t("projects.columns.description", "Description"), dataIndex: "description", ellipsis: true },
            {
              title: t("projects.columns.state", "State"),
              dataIndex: "state",
              render: (value: string) => (value ? <Tag color={value === "wellFormed" ? "green" : "orange"}>{value}</Tag> : null),
            },
          {
            title: t("projects.columns.actions", "Actions"),
            render: (_, record) => (
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={() => navigate(`/projects/${record.id}/todos`)}
                title={t("projects.buttons.select", "Select project")}
              />
            ),
          },
          ]}
        />
        {filteredProjects.length === 0 && !loading && (
          <Space direction="vertical" style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">{t("projects.empty", "No projects found for this organization.")}</Typography.Text>
          </Space>
        )}
      </Card>
    </div>
  );
}
