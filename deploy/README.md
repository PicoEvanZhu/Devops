
## 部署（简洁版）

这个目录包含一个一键部署脚本 `deploy/deploy.sh`，它会把本地代码通过 rsync 同步到目标主机，然后在远端用 Docker Compose 启动服务。

事前准备：远端需可用 Docker（Engine + Compose），你需要有 SSH 访问权限，并在仓库根目录准备好 `.env.production`（生产配置）。

默认行为：如果你直接运行 `./deploy/deploy.sh`（不带参数），脚本会使用默认目标和路径：

- target: `root@your.server.example.com`
- remote path: `/opt/azure-devops-todo`

要覆盖默认值，可以在命令行中指定 `user@host` 与 `/remote/path`。

核心流程（概览）：

1. 本地运行脚本（或先用 --dry-run 预演）
2. 脚本用 rsync 把代码和 `.env.production` 同步到远端目录
3. 在远端执行 `docker compose --env-file .env.production up -d --build`

下面是快速上手和常见说明。

### 必要文件：`.env.production`

.env.production 放远端运行时需要的环境变量，必须存在且已填写。常用项：

- FLASK_SECRET_KEY=your-secret
- VITE_API_BASE_URL=http://<SERVER_IP>:<BACKEND_PORT>
- BACKEND_PORT=5800
- FRONTEND_PORT=5801
- CORS_ORIGIN=http://<SERVER_IP>:<FRONTEND_PORT>

仓库内已有示例，请替换为你的生产值。脚本会在发现 `.env.production` 不存在或为空时停止部署。

### 常用命令

预演（不会修改远端）：

```bash
./deploy/deploy.sh --dry-run root@your.server.example.com /opt/azure-devops-todo
```

实际部署：

```bash
./deploy/deploy.sh root@your.server.example.com /opt/azure-devops-todo
```

指定同步源目录（例如只同步 build 目录）：

```bash
./deploy/deploy.sh --source ./build root@your.server.example.com /opt/app
```

### 可用选项（常用）

- --dry-run：仅列出将要同步的文件，不会改远端。
- --source <path>：指定本地同步源，默认仓库根目录。
- --no-detect-sudo：跳过自动检测远端是否需要 sudo 来运行 `docker compose`。
- --no-control-master：如果你的环境不能使用 SSH 连接复用，可用此参数禁用（脚本会尽量容错）。

脚本会尝试通过 SSH ControlMaster 建立复用连接，这样只需输入一次密码。建议直接设置 SSH 公钥认证以免密码交互。

### 同步排除（默认）

脚本默认排除常见运行时文件，避免把日志和 nohup 输出同步到远端：

- *.log
- *nohup*
- backend/nohup.out
- frontend/nohup_frontend.out

如需修改，请在脚本中调整 `RSYNC_EXCLUDES`。

### 前端构建说明

前端镜像使用多阶段构建，运行 `vite build` 生成静态文件并用 nginx 提供服务。为避免仓库中 TypeScript 错误阻塞镜像构建，Dockerfile 使用了 `build:prod`（仅运行 `vite build`）。长期建议修复 TypeScript 错误并在 CI 中做类型检查。

### 故障排查要点

- docker compose 报 YAML 解析错误：检查远端 `docker-compose.yml` 是否被意外拼接或残留多份，必要时备份再替换为仓库中的文件。
- 前端跨域或 credential 被拒：确认 `.env.production` 中 `VITE_API_BASE_URL` 与 `CORS_ORIGIN` 写成浏览器可访问的地址（IP/域名 + 端口），并在后端启用对应 origin。
- 构建时报 tsc 错误：查看具体 TypeScript 报错并修复，或继续使用 `build:prod` 作为临时变通方案。
- 部署仍需多次输入密码：检查 SSH 版本与配置，或把公钥加入远端以实现免密登录。

### 部署后验证（示例）

```bash
ssh root@your.server.example.com
cd /opt/azure-devops-todo
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail 200
curl -i http://localhost:5800/api/session
```

### 安全建议

- 把 `FLASK_SECRET_KEY` 换成强随机值并保密。
- 在可能的情况下使用 SSH 密钥认证并限制远端 SSH 访问。

需要我把 README 中的示例 IP（158.178.215.93）替换为你指定的地址吗？或把文档改成更正式的公司风格？告诉我你的偏好，我会再调整。

---
简短总结：我已把 README 文案改为更简洁、可读且易复制的风格，保留了所有必要的技术细节与示例。

文件说明：
- `deploy.sh` - 部署脚本，会把本地当前目录（仓库根）使用 `rsync` 同步到远端指定目录，然后在远端运行 `docker compose --env-file .env.production up -d --build`。
- `inventory` - 可选的目标主机列表示例，格式为 `user@host:/remote/path`。

使用前准备：
1. 确保远端主机已安装 Docker 与 Docker Compose（或 Docker Compose 插件，支持 `docker compose` 命令）。
2. 配置 SSH 可免密登录（建议使用 SSH key）。
3. 在仓库根修改（或确认）`.env.production` 中的变量，特别是 `FLASK_SECRET_KEY`、`BACKEND_PORT`、`FRONTEND_PORT`、`VITE_API_BASE_URL` 等。该文件会被同步到远端。

部署示例：
```bash
# 在仓库根执行（确保脚本可执行：chmod +x deploy/deploy.sh）
./deploy/deploy.sh deploy@1.2.3.4 /opt/azure-devops-todo
```

注意：
- 脚本会把当前目录的文件全部同步（根据 `RSYNC_EXCLUDES` 排除常见不需要的文件/目录），请确认 `.env.production` 中的生产值正确且不包含敏感信息以外的内容。
- 如果你希望仅同步已提交的代码（不包含未提交变更），可以手动先打包或切换到干净的分支/提交。
- 为了更高可用性，生产环境请使用反向代理（NGINX/Caddy）和 TLS，并对 `FLASK_SECRET_KEY` 使用强随机字符串。
