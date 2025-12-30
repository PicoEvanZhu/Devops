# Azure DevOps To-Do Manager

Small Flask + React app to browse projects and manage Azure DevOps work items (Tasks) as to-dos.

## Requirements
- Python 3.10+
- Node.js 18+ / npm
- Azure DevOps 组织名 + Personal Access Token（PAT，需具备 Work Items 读写权限）

## Backend (Flask)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export FLASK_SECRET_KEY="replace-me"   # optional but recommended
export PORT=5001                       # use 5000 if free
python app.py
```

## Frontend (React + Ant Design)
```bash
cd frontend
npm install
echo "VITE_API_BASE_URL=http://localhost:5001" > .env.local  # match backend host/port
npm run dev  # opens on :5173
```

## Docker Compose
```bash
docker-compose up --build
```
- Frontend: http://localhost:5173 (already pointed at the `backend` service)
- Backend: http://localhost:5000

## Usage
1) 打开前端 → 输入组织名 + PAT → 点击“使用 PAT 登录”。  
2) 选择项目。  
3) 管理 To-Do（Task Work Item）：创建、编辑、筛选、标记移除。

## Environment variables
- Backend:
  - `FLASK_SECRET_KEY` – secret for Flask session cookies.
  - `PORT` – 监听端口。
- Frontend:
  - `VITE_API_BASE_URL` – base URL for the backend API (default `http://localhost:5000`).

## Notes
- PAT 仅存储在服务端内存会话，不落盘、不记录。
- 401/403 会返回清晰错误；项目列表示例处理了续页；Work Items 获取分批避免 API 限制。

## Deployment SSH key
- Private key: `~/.ssh/devops_deploy_ed25519`
- Public key: `~/.ssh/devops_deploy_ed25519.pub`
- Public key content:
  ```text
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBAp3/uh0U9XwXGUAcCUzV9PcHzEUm5Nbj86F/qCYZiQ devops-deploy
  ```
  deployer:jqYS5G5lVKj53IKDQCFrTCnT%
  O_7qibP]Av6g
