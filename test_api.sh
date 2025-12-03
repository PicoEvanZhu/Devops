#!/bin/bash

# 测试 API 登录和获取 todos
# 请替换以下变量为您的实际值
ORGANIZATION="your-organization"
PAT="your-personal-access-token"
API_BASE="http://localhost:5001"

echo "=== 步骤1: 登录 ==="
LOGIN_RESPONSE=$(curl -s -c cookies.txt -X POST "${API_BASE}/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"organization\":\"${ORGANIZATION}\",\"pat\":\"${PAT}\"}")
echo "$LOGIN_RESPONSE"

echo -e "\n=== 步骤2: 检查会话 ==="
SESSION_RESPONSE=$(curl -s -b cookies.txt "${API_BASE}/api/session")
echo "$SESSION_RESPONSE"

echo -e "\n=== 步骤3: 获取所有 Todos ==="
TODOS_RESPONSE=$(curl -s -b cookies.txt "${API_BASE}/api/todos?page=1&pageSize=20")
echo "$TODOS_RESPONSE"

echo -e "\n=== 清理 ==="
rm -f cookies.txt
