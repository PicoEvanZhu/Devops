
## 快速部署指南

简短目标：把本地代码同步到远端并用 Docker Compose 启动服务。

前置条件：
- 远端已安装 Docker（Engine + Compose）
- 你有远端 SSH 访问权限（建议配置公钥免密登录）
- 仓库根有 `.env.production`（包含生产配置，尤其是 `FLASK_SECRET_KEY`）

默认行为：
- 直接运行 `./deploy/deploy.sh` 会使用 `deploy/inventory` 的首条目标（或环境变量 `DEPLOY_TARGET` 覆盖）。

常用命令：

预演（只显示将同步的文件）：

```bash
./deploy/deploy.sh --dry-run
```

实际部署（使用默认目标或也可显式传 target/path）：

```bash
./deploy/deploy.sh
# 或： ./deploy/deploy.sh user@host /remote/path
```

指定仅同步子目录：

```bash
./deploy/deploy.sh --source ./build
```

要点（简洁版）：
- `.env.production` 会被同步到远端并在 `docker compose --env-file .env.production up -d --build` 中使用。
- 脚本尝试用 SSH ControlMaster 复用连接，通常只需输入一次密码。
- 默认排除项包括 `.git`、node_modules、*.log、nohup 输出等（可在脚本里调整 `RSYNC_EXCLUDES`）。

快速校验（部署后）：

```bash
ssh user@host
cd /opt/azure-devops-todo
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail 200
curl -i http://localhost:5800/api/session
```

常见问题（简短）：
- 若看到 `FLASK_SECRET_KEY` 为空或警告：请在 `.env.production` 填入强随机值并重新部署。
- 若构建时报关于 `VITE_API_BASE_URL` 的警告：检查 `.env.production` 是否已被正确同步并在 Dockerfile/compose 中传入为 build-arg（脚本会打印远端 .env 供确认）。
- 若需要多次输入密码：请配置 SSH 公钥或确保 SSH ControlMaster 能在你的环境下工作。

安全提示：不要把真实 secret 提交到公共仓库；可在私有环境或通过 secret 管理器注入生产密钥。

需要我把 README 再改得更短或改为公司风格吗？
