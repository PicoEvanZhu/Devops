# API 无数据返回问题解决方案

## 问题描述

访问 `http://localhost:5001/api/todos?page=1&pageSize=20` 接口时返回 401 错误：
```json
{
  "error": "Not authenticated"
}
```

## 根本原因

`/api/todos` 接口需要用户先通过 Azure DevOps 凭证登录。后端使用 Flask session 来存储用户的登录状态（organization 和 PAT）。

## 解决方案

### 方法1：通过前端界面登录（推荐）

1. **启动前端**（如果还未启动）：
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

2. **访问前端页面**：
   打开浏览器访问 `http://localhost:5173`

3. **登录**：
   - 输入您的 Azure DevOps 组织名称（例如：`myorganization`）
   - 输入您的 Personal Access Token (PAT)
   - 点击登录

4. **查看数据**：
   登录成功后，导航到 "All Todos" 页面即可看到数据

### 方法2：通过 API 测试

如果您想直接测试 API，需要先登录获取 session cookie。

#### 使用提供的测试脚本：

```bash
# 使用 Python 测试脚本
python test_api.py <your-organization> <your-pat>

# 或使用 Bash 测试脚本
./test_api.sh  # 需要先编辑脚本中的 ORGANIZATION 和 PAT 变量
```

#### 手动测试流程：

```bash
# 1. 登录并保存 cookie
curl -c cookies.txt -X POST http://localhost:5001/api/login \
  -H "Content-Type: application/json" \
  -d '{"organization":"YOUR_ORG","pat":"YOUR_PAT"}'

# 2. 使用 cookie 访问 /api/todos
curl -b cookies.txt "http://localhost:5001/api/todos?page=1&pageSize=20"

# 3. 清理
rm cookies.txt
```

## 获取 Azure DevOps Personal Access Token (PAT)

1. 登录到 Azure DevOps：`https://dev.azure.com/{your-organization}`
2. 点击右上角的用户设置图标
3. 选择 "Personal access tokens"
4. 点击 "New Token"
5. 配置权限（至少需要 Work Items 的读写权限）
6. 复制生成的 token

## 验证后端配置

确保后端正在运行：
```bash
# 检查端口监听
lsof -i :5001

# 测试 session 接口
curl http://localhost:5001/api/session
# 应该返回: {"authenticated": false}
```

## 常见问题

### Q: 为什么前端无法获取数据？
A: 前端需要通过登录页面获取 Azure DevOps 凭证并建立 session。直接访问 API 端点会因为缺少认证信息而失败。

### Q: Cookie 配置正确吗？
A: 检查 `backend/app.py` 中的 CORS 和 session 配置：
```python
CORS(app, supports_credentials=True, origins="*")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
```

### Q: 前端如何传递认证信息？
A: 前端的 `api.ts` 中配置了 `credentials: "include"`，这会自动发送 cookie：
```typescript
const response = await fetch(`${API_BASE}${path}`, {
  credentials: "include",
  // ...
});
```

## 代码流程说明

1. **用户登录** → `POST /api/login` → 验证 Azure DevOps 凭证 → 存储到 session
2. **访问数据** → `GET /api/todos` → 检查 session → 查询 Azure DevOps → 返回数据
3. **登出** → `POST /api/logout` → 清除 session

## 下一步

如果问题仍然存在，请检查：
- [ ] 后端是否正常运行在 5001 端口
- [ ] 前端是否正确配置了 API_BASE_URL
- [ ] Azure DevOps 凭证是否有效
- [ ] 浏览器是否允许 cookie
- [ ] 查看浏览器开发者工具的 Network 标签页，检查请求和响应
