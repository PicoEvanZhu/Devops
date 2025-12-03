#!/usr/bin/env python3
"""
调试 Azure DevOps 查询
"""

import sys
import requests

def debug_query(organization: str, pat: str):
    API_BASE = "http://localhost:5001"
    session = requests.Session()
    
    # 登录
    print("=== 登录 ===")
    login_response = session.post(
        f"{API_BASE}/api/login",
        json={"organization": organization, "pat": pat}
    )
    if login_response.status_code != 200:
        print(f"❌ 登录失败: {login_response.text}")
        return
    print("✅ 登录成功\n")
    
    # 获取项目列表
    print("=== 获取项目列表 ===")
    projects_response = session.get(f"{API_BASE}/api/projects")
    if projects_response.status_code != 200:
        print(f"❌ 获取项目失败: {projects_response.text}")
        return
    
    projects = projects_response.json().get('projects', [])
    print(f"找到 {len(projects)} 个项目:")
    for p in projects:
        print(f"  - {p.get('name')} (ID: {p.get('id')})")
    
    if not projects:
        print("\n⚠️  没有找到任何项目！")
        return
    
    print("\n=== 测试单个项目的 Todos ===")
    for project in projects[:3]:  # 测试前3个项目
        project_id = project.get('id')
        project_name = project.get('name')
        print(f"\n项目: {project_name}")
        
        todos_response = session.get(
            f"{API_BASE}/api/projects/{project_id}/todos?page=1&pageSize=20"
        )
        
        if todos_response.status_code == 200:
            todos = todos_response.json().get('todos', [])
            print(f"  ✅ 找到 {len(todos)} 条工作项")
            if todos:
                for todo in todos[:3]:
                    print(f"     - [{todo.get('id')}] {todo.get('title')} ({todo.get('workItemType')})")
        else:
            print(f"  ❌ 查询失败: {todos_response.text}")
    
    print("\n=== 测试所有项目的 Todos (聚合) ===")
    all_todos_response = session.get(f"{API_BASE}/api/todos?page=1&pageSize=20")
    if all_todos_response.status_code == 200:
        all_todos = all_todos_response.json().get('todos', [])
        print(f"✅ 聚合查询返回 {len(all_todos)} 条工作项")
        if all_todos:
            print("\n前5条:")
            for todo in all_todos[:5]:
                print(f"  - [{todo.get('id')}] {todo.get('title')} (项目: {todo.get('projectName')})")
        else:
            print("⚠️  聚合查询返回0条，但单个项目有数据，可能是聚合逻辑有问题")
    else:
        print(f"❌ 聚合查询失败: {all_todos_response.text}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("使用方法: python debug_query.py <organization> <pat>")
        sys.exit(1)
    
    organization = sys.argv[1]
    pat = sys.argv[2]
    debug_query(organization, pat)
