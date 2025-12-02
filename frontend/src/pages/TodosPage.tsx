import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Drawer,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import { RichTextEditor } from "../components/RichTextEditor";
import type { TodoItem } from "../types";

const typeColors: Record<string, string> = {
  Task: "blue",
  "Product Backlog Item": "green",
  Bug: "red",
  "User Story": "purple",
  Feature: "gold",
};

type FormValues = {
  title?: string;
  description?: string;
  priority?: number;
  assignedTo?: string;
  tags?: string[];
  state?: string;
  areaPath?: string;
  iterationPath?: string;
  effort?: number;
};

export function TodosPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [filters, setFilters] = useState<{ state?: string; keyword?: string; assignedTo?: string; type?: string }>({
    assignedTo: "Evan",
  });
  const [tagOptions, setTagOptions] = useState<{ label: string; value: string }[]>([]);
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();

  const projectLabel = useMemo(() => projectId || "Project", [projectId]);

  const loadTodos = async (nextFilters = filters, page = pagination.current, pageSize = pagination.pageSize) => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.listTodos(projectId, { ...nextFilters, page, pageSize });
      setTodos(res.todos || []);
      const hasMore = res.hasMore;
      const total = hasMore ? page * pageSize + 1 : (page - 1) * pageSize + (res.todos?.length || 0);
      setPagination({ current: page, pageSize, total });
    } catch (err: any) {
      message.error(err.message || "Failed to load to-dos");
    } finally {
      setLoading(false);
    }
  };

  const fetchTags = async (search?: string) => {
    if (!projectId) return;
    try {
      const res = await api.listTags(projectId, search);
      const options = (res.tags || []).map((tag) => ({ label: tag, value: tag }));
      setTagOptions(options);
    } catch (err: any) {
      message.error(err.message || "Failed to load tags");
    }
  };

  useEffect(() => {
    // reset to default assigned filter on project change
    const baseFilters = { ...filters, assignedTo: filters.assignedTo || "Evan" };
    setFilters(baseFilters);
    loadTodos(baseFilters, 1, pagination.pageSize);
    fetchTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openCreateModal = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ assignedTo: "Evan Zhu" });
    setDrawerOpen(true);
    fetchTags();
  };

  const openEditModal = (item: TodoItem) => {
    setEditing(item);
    form.setFieldsValue({
      title: item.title,
      description: (item as any).description,
      priority: item.priority,
      assignedTo: item.assignedTo,
      tags: item.tags,
      state: item.state,
    });
    setDrawerOpen(true);
    fetchTags();
  };

  const handleSubmit = async () => {
    if (!projectId) return;
    const values = await form.validateFields();
    const cleanArea = typeof values.areaPath === "string" ? values.areaPath.replace(/^[/\\]+/, "") : values.areaPath;
    const cleanIteration =
      typeof values.iterationPath === "string" ? values.iterationPath.replace(/^[/\\]+/, "") : values.iterationPath;
    const payload = { ...values, areaPath: cleanArea, iterationPath: cleanIteration };
    setLoading(true);
    try {
      if (editing) {
        await api.updateTodo(projectId, editing.id, payload);
        message.success("Updated to-do");
      } else {
        await api.createTodo(projectId, payload);
        message.success("Created to-do");
      }
      setDrawerOpen(false);
      await loadTodos();
    } catch (err: any) {
      message.error(err.message || "Operation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item: TodoItem) => {
    if (!projectId) return;
    setLoading(true);
    try {
      await api.deleteTodo(projectId, item.id);
      message.success("Marked as removed");
      await loadTodos();
    } catch (err: any) {
      message.error(err.message || "Delete failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <Typography.Text strong>{projectLabel}</Typography.Text>
          <Tag color="blue">To-Dos</Tag>
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => loadTodos()} />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            New To-Do
          </Button>
        </Space>
      }
    >
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={24} md={6}>
          <Input
            placeholder="Search title"
            prefix={<SearchOutlined />}
            allowClear
            onChange={(e) => {
              const next = { ...filters, keyword: e.target.value || undefined };
              setFilters(next);
              loadTodos(next);
            }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Input
            placeholder="Assigned to"
            prefix={<UserOutlined />}
            allowClear
            onChange={(e) => {
              const next = { ...filters, assignedTo: e.target.value || undefined };
              setFilters(next);
              loadTodos(next);
            }}
          />
        </Col>
        <Col xs={24} md={6}>
          <Select
            allowClear
            placeholder="State"
            style={{ width: "100%" }}
            onChange={(value) => {
              const next = { ...filters, state: value || undefined };
              setFilters(next);
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
            allowClear
            placeholder="Work item type"
            style={{ width: "100%" }}
            onChange={(value) => {
              const next = { ...filters, type: value || undefined };
              setFilters(next);
              loadTodos(next);
            }}
            options={["Task", "Product Backlog Item", "User Story", "Bug", "Feature"].map((value) => ({
              label: value,
              value,
            }))}
          />
        </Col>
      </Row>

      <Table<TodoItem>
        dataSource={todos}
        loading={loading}
        rowKey="id"
        onRow={(record) => ({
          onDoubleClick: () => openEditModal(record),
          style: { cursor: "pointer" },
        })}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          onChange: (page, pageSize) => loadTodos(filters, page, pageSize),
        }}
        columns={[
          { title: "ID", dataIndex: "id", width: 80 },
          { title: "Title", dataIndex: "title", ellipsis: true, width: 320 },
      {
        title: "Type",
        dataIndex: "workItemType",
        render: (value?: string) => (value ? <Tag color={typeColors[value] || "default"}>{value}</Tag> : "-"),
      },
      {
        title: "State",
        dataIndex: "state",
        render: (value: string) => (value ? <Tag color={value === "New" ? "blue" : value === "Closed" ? "green" : "gold"}>{value}</Tag> : null),
      },
      {
        title: "Priority",
        dataIndex: "priority",
        width: 90,
      },
      {
        title: "Assigned To",
        dataIndex: "assignedTo",
      },
      {
        title: "Area",
        dataIndex: "areaPath",
        ellipsis: true,
      },
      {
        title: "Iteration",
        dataIndex: "iterationPath",
        ellipsis: true,
      },
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
            title: "Created",
            dataIndex: "createdDate",
            render: (value: string) => (value ? new Date(value).toLocaleString() : "-"),
          },
          {
            title: "Actions",
            render: (_, record) => (
              <Space>
                <Button icon={<EditOutlined />} onClick={() => openEditModal(record)} />
                <Popconfirm title="Mark as removed?" onConfirm={() => handleDelete(record)}>
                  <Button danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={editing ? "Edit To-Do" : "New To-Do"}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={1200}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
            <Button type="primary" loading={loading} onClick={handleSubmit}>
              {editing ? "Save" : "Create"}
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" form={form}>
          <Form.Item label="Title" name="title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <RichTextEditor
              value={form.getFieldValue("description")}
              onChange={(html) => form.setFieldsValue({ description: html })}
              placeholder="Rich text: paste images, add links"
            />
          </Form.Item>
          <Form.Item label="Priority" name="priority">
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Assigned To" name="assignedTo">
            <Input placeholder="e.g. user@domain.com" />
          </Form.Item>
          <Form.Item label="Tags" name="tags">
            <Select
              mode="tags"
              placeholder="Add tags"
              options={tagOptions}
              showSearch
              onFocus={() => fetchTags()}
              onSearch={(val) => fetchTags(val)}
            />
          </Form.Item>
          <Form.Item label="State" name="state">
            <Select
              allowClear
              options={["New", "Active", "Resolved", "Closed"].map((value) => ({
                label: value,
                value,
              }))}
            />
          </Form.Item>
        </Form>
      </Drawer>

      <Button style={{ marginTop: 12 }} onClick={() => navigate("/projects")}>
        Back to projects
      </Button>
    </Card>
  );
}
