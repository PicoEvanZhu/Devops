import { BellOutlined, GlobalOutlined, LogoutOutlined } from "@ant-design/icons";
import { Badge, Button, Empty, Layout, Popover, Spin, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { api } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { AllTodosPage } from "./pages/AllTodosPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TodosPage } from "./pages/TodosPage";
import { I18nProvider, useI18n } from "./i18n";
import type { SessionInfo } from "./types";

const { Header, Content } = Layout;

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </I18nProvider>
  );
}

function Shell() {
  const [session, setSession] = useState<SessionInfo>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [mentionItems, setMentionItems] = useState<any[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionReadIds, setMentionReadIds] = useState<string[]>([]);
  const mentionRefreshRef = useRef<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { t, toggleLanguage } = useI18n();

  useEffect(() => {
    api
      .session()
      .then((res) => setSession(res))
      .catch(() => setSession({ authenticated: false }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("mentionReadIds");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setMentionReadIds(parsed.filter((val) => typeof val === "string"));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const mentionReadSet = useMemo(() => new Set(mentionReadIds), [mentionReadIds]);
  const unreadMentionCount = useMemo(() => {
    if (!mentionItems.length) return 0;
    return mentionItems.filter((item) => !mentionReadSet.has(`${item.projectId}:${item.id}`)).length;
  }, [mentionItems, mentionReadSet]);

  const persistMentionReadIds = (next: string[]) => {
    setMentionReadIds(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("mentionReadIds", JSON.stringify(next));
    }
  };

  const markMentionRead = (item: any) => {
    const key = `${item.projectId}:${item.id}`;
    if (mentionReadSet.has(key)) return;
    const next = [...mentionReadIds, key];
    persistMentionReadIds(next);
  };

  const handleMentionClick = (item: any) => {
    markMentionRead(item);
    setMentionOpen(false);
    if (item?.projectId && item?.workItemId) {
      const target = `/projects/${encodeURIComponent(item.projectId)}/todos?openTodoId=${encodeURIComponent(
        item.workItemId
      )}`;
      navigate(target);
    }
  };

  const fetchMentions = () => {
    if (!session.authenticated) return;
    setMentionLoading(true);
    api
      .listMentions()
      .then((res) => setMentionItems(res.items || []))
      .catch(() => setMentionItems([]))
      .finally(() => setMentionLoading(false));
  };

  useEffect(() => {
    if (!session.authenticated) {
      setMentionItems([]);
      return;
    }
    fetchMentions();
    if (mentionRefreshRef.current) {
      window.clearInterval(mentionRefreshRef.current);
    }
    mentionRefreshRef.current = window.setInterval(() => {
      fetchMentions();
    }, 5 * 60 * 1000) as unknown as number;
    return () => {
      if (mentionRefreshRef.current) {
        window.clearInterval(mentionRefreshRef.current);
      }
    };
  }, [session.authenticated]);

  const handleLogin = (sessionInfo: SessionInfo) => {
    setSession(sessionInfo);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err: any) {
      message.error(err.message || "Logout failed");
    } finally {
      setMentionItems([]);
      setMentionReadIds([]);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("mentionReadIds");
      }
      setSession({ authenticated: false });
      navigate("/");
    }
  };

  if (loading) {
    return (
      <div className="centered">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="brand">{t("app.brand", "Pico Project IT Project Manage")}</div>
        <div className="header-actions">
          <Button
            style={{ marginRight: 12 }}
            icon={<GlobalOutlined />}
            aria-label={t("app.languageButton", "中/EN")}
            title={t("app.languageButton", "中/EN")}
            onClick={toggleLanguage}
          />
          {session.authenticated && location.pathname !== "/projects" && (
            <Button style={{ marginRight: 12 }} onClick={() => navigate("/projects")}>
              {t("app.backToProjects", "Back to Projects")}
            </Button>
          )}
          {session.authenticated ? (
            <>
              <Popover
                trigger="click"
                placement="bottomRight"
                open={mentionOpen}
                onOpenChange={(open) => {
                  setMentionOpen(open);
                }}
                content={
                  <div className="mention-popover">
                    <div className="mention-header">
                      <Typography.Text strong>{t("app.notifications", "Notifications")}</Typography.Text>
                      <Typography.Text type="secondary">
                        {unreadMentionCount > 99 ? "99+" : unreadMentionCount}
                      </Typography.Text>
                    </div>
                    {mentionLoading ? (
                      <div className="mention-loading">
                        <Spin size="small" />
                      </div>
                    ) : mentionItems.length === 0 ? (
                      <Empty description={t("app.noNotifications", "No notifications")} />
                    ) : (
                      <div className="mention-list">
                        {mentionItems.map((item) => {
                          const key = `${item.projectId}:${item.id}`;
                          const isRead = mentionReadSet.has(key);
                          return (
                            <button
                              type="button"
                              key={key}
                              className={`mention-item ${isRead ? "is-read" : "is-unread"}`}
                              onClick={() => handleMentionClick(item)}
                            >
                              <div className="mention-item-title">
                                <span>{item.title || t("app.untitledTodo", "Untitled")}</span>
                                <Tag color={isRead ? "default" : "green"}>{isRead ? t("app.read", "已读") : t("app.unread", "未读")}</Tag>
                              </div>
                              <div className="mention-item-meta">
                                <span>{item.projectName || item.projectId}</span>
                                <span>{item.createdBy || t("app.unknownUser", "Unknown")}</span>
                                <span>{item.createdDate ? dayjs(item.createdDate).format("YYYY-MM-DD HH:mm") : "-"}</span>
                              </div>
                              <div className="mention-item-preview">{item.preview || ""}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                }
              >
                <Badge count={unreadMentionCount} overflowCount={99} offset={[-2, 2]}>
                  <Button
                    style={{ marginRight: 12 }}
                    icon={<BellOutlined />}
                    aria-label={t("app.notifications", "Notifications")}
                    title={t("app.notifications", "Notifications")}
                  />
                </Badge>
              </Popover>
              <Typography.Text style={{ color: "#fff" }}>
                {t("app.orgLabel", "Org")}: {session.organization || "Unknown"}
              </Typography.Text>
              <Button icon={<LogoutOutlined />} onClick={handleLogout}>
                {t("app.logout", "Logout")}
              </Button>
            </>
          ) : (
            <Typography.Text style={{ color: "#fff" }}>{t("app.pleaseSignIn", "Please sign in")}</Typography.Text>
          )}
        </div>
      </Header>
      <Content className="app-content">
        <Routes>
          <Route
            path="/"
            element={
              session.authenticated ? (
                <Navigate to="/projects" replace />
              ) : (
                <LoginPage onLogin={handleLogin} />
              )
            }
          />
          <Route
            path="/projects"
            element={
              <RequireAuth authenticated={session.authenticated}>
                <ProjectsPage session={session} />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:projectId/todos"
            element={
              <RequireAuth authenticated={session.authenticated}>
                <TodosPage />
              </RequireAuth>
            }
          />
          <Route
            path="/todos"
            element={
              <RequireAuth authenticated={session.authenticated}>
                <AllTodosPage />
              </RequireAuth>
            }
          />
          <Route
            path="*"
            element={<Navigate to={session.authenticated ? "/projects" : "/"} replace state={{ from: location }} />}
          />
        </Routes>
      </Content>
    </Layout>
  );
}

function RequireAuth({ authenticated, children }: { authenticated: boolean; children: React.ReactNode }) {
  const location = useLocation();
  if (!authenticated) {
    return <Navigate to="/" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
