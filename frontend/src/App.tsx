import { LogoutOutlined } from "@ant-design/icons";
import { Button, Layout, Spin, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { api } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { AllTodosPage } from "./pages/AllTodosPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { TodosPage } from "./pages/TodosPage";
import type { SessionInfo } from "./types";

const { Header, Content } = Layout;

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

function Shell() {
  const [session, setSession] = useState<SessionInfo>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    api
      .session()
      .then((res) => setSession(res))
      .catch(() => setSession({ authenticated: false }))
      .finally(() => setLoading(false));
  }, []);

  const handleLogin = (organization: string) => {
    setSession({ authenticated: true, organization });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (err: any) {
      message.error(err.message || "Logout failed");
    } finally {
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
        <div className="brand">Pico Project IT Project Manage</div>
        <div className="header-actions">
          {session.authenticated && (
            <Button style={{ marginRight: 12 }} onClick={() => navigate("/projects")}>
              Back to Projects
            </Button>
          )}
          {session.authenticated ? (
            <>
              <Typography.Text style={{ color: "#fff" }}>
                Org: {session.organization || "Unknown"}
              </Typography.Text>
              <Button icon={<LogoutOutlined />} onClick={handleLogout}>
                Logout
              </Button>
            </>
          ) : (
            <Typography.Text style={{ color: "#fff" }}>Please sign in</Typography.Text>
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
                <ProjectsPage />
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
