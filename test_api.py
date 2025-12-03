#!/usr/bin/env python3
"""
测试 API 登录和获取 todos
使用方法：
  python test_api.py <organization> <pat>
"""

import sys
import requests

def test_api(organization: str, pat: str):
    API_BASE = "http://localhost:5001"
    session = requests.Session()
    
    print("=== 步骤1: 登录 ===")
    login_response = session.post(
        f"{API_BASE}/api/login",
        json={"organization": organization, "pat": pat}
    )
    print(f"状态码: {login_response.status_code}")
    print(f"响应: {login_response.json()}\n")
    
    if login_response.status_code != 200:
        print("❌ 登录失败!")
        return
    
    print("✅ 登录成功!\n")
    
    print("=== 步骤2: 检查会话 ===")
    session_response = session.get(f"{API_BASE}/api/session")
    print(f"状态码: {session_response.status_code}")
    print(f"响应: {session_response.json()}\n")
    
    print("=== 步骤3: 获取所有 Todos ===")
    todos_response = session.get(f"{API_BASE}/api/todos?page=1&pageSize=20")
    print(f"状态码: {todos_response.status_code}")
    
    if todos_response.status_code == 200:
        data = todos_response.json()
        todos = data.get('todos', [])
        print(f"✅ 成功获取 {len(todos)} 条 todos")
        if todos:
            print("\n前3条 todos:")
            for todo in todos[:3]:
                print(f"  - ID: {todo.get('id')}, Title: {todo.get('title')}")
    else:
        print(f"❌ 获取失败: {todos_response.text}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("使用方法:")
        print("  python test_api.py <organization> <pat>")
        print("\n示例:")
        print("  python test_api.py myorg dg4n2xxxxxxxxxxxxxxxxx")
        sys.exit(1)
    
    organization = sys.argv[1]
    pat = sys.argv[2]
    test_api(organization, pat)
