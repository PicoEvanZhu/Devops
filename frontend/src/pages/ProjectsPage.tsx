import { ArrowRightOutlined, ReloadOutlined, UserOutlined } from "@ant-design/icons";
import { AutoComplete, Button, Card, Col, Row, Space, Table, Tag, Typography, message } from "antd";
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
const normalizeOwnerToken = (value?: string) => (value || "").toLowerCase().trim();
const compactOwnerToken = (value?: string) => normalizeOwnerToken(value).replace(/[^a-z0-9]/g, "");
const isOwnerTokenMatch = (assigned: string, token: string) => {
  const normalizedAssigned = normalizeOwnerToken(assigned);
  const normalizedToken = normalizeOwnerToken(token);
  if (!normalizedAssigned || !normalizedToken) return false;
  if (normalizedAssigned.includes(normalizedToken) || normalizedToken.includes(normalizedAssigned)) return true;
  const compactAssigned = compactOwnerToken(assigned);
  const compactToken = compactOwnerToken(token);
  if (!compactAssigned || !compactToken) return false;
  return compactAssigned.includes(compactToken) || compactToken.includes(compactAssigned);
};

const getTodoStatusTone = (state?: string) => {
  const normalized = normalizeState(state);
  if (normalized === "closed" || normalized === "resolved") return "green";
  if (normalized === "active" || normalized === "validate") return "blue";
  if (normalized === "new") return "gold";
  return "default";
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
  const navigate = useNavigate();
  const { t } = useI18n();
  const weekdayLabel = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dayjs().day()];

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

  const isOwnerMatch = (value?: string) => {
    if (!value) return false;
    if (userTokens.length === 0) return true;
    return userTokens.some((token) => isOwnerTokenMatch(value, token));
  };

  const ownerTokens = useMemo(() => {
    if (ownerFilter) {
      const normalized = ownerFilter.toLowerCase();
      const matchesCurrent = userTokens.some((token) => normalized.includes(token) || token.includes(normalized));
      return matchesCurrent ? Array.from(new Set([normalized, ...userTokens])) : [normalized];
    }
    return userTokens;
  }, [ownerFilter, userTokens]);

  const isOwnedByUser = (item: TodoItem) => {
    if (ownerTokens.length === 0) return true;
    const assigned = item.assignedTo || "";
    if (!assigned) return true;
    return ownerTokens.some((token) => isOwnerTokenMatch(assigned, token));
  };

  const loadDashboard = async () => {
    setDashboardLoading(true);
    try {
      const assignedTo =
        ownerFilter ||
        effectiveSession.user?.email ||
        effectiveSession.user?.uniqueName ||
        effectiveSession.user?.displayName;
      const res = await api.listAllTodos({ pageSize: 1000, assignedTo });
      const items = res.todos || [];
      const ownedItems = items.filter(isOwnedByUser);
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

      setSummary({ ...counts, overdue: overdueCount });
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

  const handleDashboardRefresh = () => {
    loadDashboard();
    load();
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
        (cachedOwner && isOwnerMatch(cachedOwner) ? cachedOwner : "") ||
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
  }, [ownerFilter, ownerTokens]);

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
          value: identity.displayName || identity.mail || identity.uniqueName || identity.id || value,
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

  const metricCards = useMemo(
    () => [
      { label: t("dashboard.metrics.todo", "待办"), value: summary.todo, tone: "todo", tabKey: "no-start" },
      { label: t("dashboard.metrics.active", "进行中"), value: summary.active, tone: "active", tabKey: "on-going" },
      { label: t("dashboard.metrics.done", "已完成"), value: summary.done, tone: "done", tabKey: "completed" },
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
            <div className="dashboard-hero-quote">
              <Typography.Text>
                {t("dashboard.quote.line2", "所有的目标，都是经过分解，逐步实现才能达成。")}
              </Typography.Text>
              <Typography.Text>
                {t("dashboard.quote.line1", "希望我们见证彼此的成长，互助前行。")}
              </Typography.Text>
            </div>
            <Typography.Text className="dashboard-hero-sub">
              {t("dashboard.subtitle", "今天也要稳步推进你的目标")}
            </Typography.Text>
          </div>
          <div className="dashboard-hero-badge">
            <span>{t("dashboard.heroBadge", "每日节奏")}</span>
            <strong>
              {dayjs().format("MM/DD")} {weekdayLabel}
            </strong>
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
        <div className="dashboard-filter-spacer" />
        <Button icon={<ReloadOutlined />} onClick={handleDashboardRefresh} loading={dashboardLoading || loading}>
          {t("projects.buttons.refresh", "Refresh")}
        </Button>
      </div>

      <Row gutter={[20, 20]} className="dashboard-metrics">
        {metricCards.map((metric) => (
          <Col xs={12} md={6} key={metric.label}>
            <Card
              className={`dashboard-metric-card tone-${metric.tone}`}
              bordered={false}
              hoverable={Boolean(metric.tabKey)}
              onClick={() => {
                if (metric.tabKey) {
                  navigate(`/todos?tab=${metric.tabKey}`);
                }
              }}
            >
              <Typography.Text className="dashboard-metric-label">{metric.label}</Typography.Text>
              <div className="dashboard-metric-value">{metric.value}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title={t("projects.title", "Projects")}
        extra={
          <Space>
            <Button type="primary" onClick={() => navigate("/todos")}>
              {t("projects.buttons.allTodos", "All To-Dos")}
            </Button>
          </Space>
        }
        className="dashboard-panel"
      >
        <Table<Project>
          dataSource={projects}
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
        {projects.length === 0 && !loading && (
          <Space direction="vertical" style={{ marginTop: 12 }}>
            <Typography.Text type="secondary">{t("projects.empty", "No projects found for this organization.")}</Typography.Text>
          </Space>
        )}
      </Card>
    </div>
  );
}
