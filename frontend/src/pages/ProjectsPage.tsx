import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Space, Table, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import type { Project } from "../types";

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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
  }, []);

  return (
    <Card
      title="Projects"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Refresh
          </Button>
          <Button type="primary" onClick={() => navigate("/todos")}>
            All To-Dos
          </Button>
        </Space>
      }
    >
      <Table<Project>
        dataSource={projects}
        loading={loading}
        rowKey="id"
        pagination={false}
        columns={[
          { title: "Name", dataIndex: "name" },
          { title: "Description", dataIndex: "description", ellipsis: true },
          {
            title: "State",
            dataIndex: "state",
            render: (value: string) => (value ? <Tag color={value === "wellFormed" ? "green" : "orange"}>{value}</Tag> : null),
          },
          {
            title: "Actions",
            render: (_, record) => (
              <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate(`/projects/${record.id}/todos`)}>
                Select project
              </Button>
            ),
          },
        ]}
      />
      {projects.length === 0 && !loading && (
        <Space direction="vertical" style={{ marginTop: 12 }}>
          <Typography.Text type="secondary">No projects found for this organization.</Typography.Text>
        </Space>
      )}
    </Card>
  );
}
