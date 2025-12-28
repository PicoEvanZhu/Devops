import { LockOutlined, LoginOutlined } from "@ant-design/icons";
import { Button, Card, Form, Input, Typography, message } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../api";
import type { SessionInfo } from "../types";

type Props = {
  onLogin: (session: SessionInfo) => void;
};

const defaultOrg = "Pico-Group";

export function LoginPage({ onLogin }: Props) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .session()
      .then((res) => {
        if (res.authenticated && res.organization) {
          onLogin(res);
          message.success("Already signed in");
        }
      })
      .catch(() => void 0);
  }, [onLogin]);

  const onFinish = async (values: any) => {
    const { organization, pat } = values;
    if (!organization || !pat) {
      message.error("Organization and PAT are required");
      return;
    }
    setLoading(true);
    try {
      await api.login(organization, pat);
      message.success("Signed in");
      const sessionInfo = await api.session();
      onLogin(sessionInfo);
      navigate("/projects");
    } catch (err: any) {
      message.error(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="centered">
      <Card title="Azure DevOps Login" style={{ width: 420 }}>
        <Typography.Paragraph type="secondary">
          输入组织名和个人访问令牌（PAT）。令牌仅保存在会话内存，不会落盘。
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={onFinish} initialValues={{ organization: defaultOrg }}>
          <Form.Item label="Organization" name="organization" rules={[{ required: true }]}>
            <Input placeholder="e.g. Pico-Group" />
          </Form.Item>
          <Form.Item label="Personal Access Token" name="pat" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Enter PAT" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block icon={<LoginOutlined />} loading={loading}>
            使用 PAT 登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
