import os
import logging
from typing import Dict, Optional, List

from dotenv import load_dotenv
from flask import Flask, jsonify, request, session, make_response
from flask_cors import CORS

from azure_devops_client import AzureDevOpsAuthError, AzureDevOpsClient, AzureDevOpsError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Load env files for local dev convenience (non-production)
load_dotenv(os.path.join(BASE_DIR, ".env.dev"), override=False)
load_dotenv(override=False)

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = False
app.logger.setLevel(logging.INFO)

# Configure CORS: allow specifying a production origin via CORS_ORIGIN env var.
# For local development the default remains '*' but when credentials are used
# browsers reject '*' with credentials, so set CORS_ORIGIN in production.
cors_origin = os.environ.get("CORS_ORIGIN", "*")
CORS(app, supports_credentials=True, origins=cors_origin)


def _require_client() -> AzureDevOpsClient:
    organization = session.get("organization")
    pat = session.get("pat")
    if not organization or not pat:
        raise AzureDevOpsAuthError("Not authenticated", status_code=401)
    return AzureDevOpsClient(organization, pat)


@app.route("/api/login", methods=["POST"])
def login() -> tuple:
    data = request.get_json(force=True, silent=True) or {}
    organization = data.get("organization")
    pat = data.get("pat")

    if not organization or not pat:
        return jsonify({"error": "organization and pat are required"}), 400

    client = AzureDevOpsClient(organization, pat)
    try:
        client.list_projects(top=1)
    except AzureDevOpsAuthError as exc:  # Authentication failed against Azure DevOps
        return jsonify({"error": str(exc)}), 401
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500

    session["organization"] = organization
    session["pat"] = pat
    session.permanent = True
    return jsonify({"success": True, "organization": organization})


@app.route("/api/logout", methods=["POST"])
def logout() -> tuple:
    session.clear()
    return jsonify({"success": True})


@app.route("/api/session", methods=["GET"])
def session_info() -> tuple:
    organization = session.get("organization")
    if not organization:
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "organization": organization})


@app.route("/api/projects", methods=["GET"])
def list_projects() -> tuple:
    client = _require_client()
    try:
        projects = client.list_projects()
        return jsonify({"projects": projects})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos", methods=["GET"])
def list_todos(project_id: str) -> tuple:
    client = _require_client()
    state = request.args.get("state")
    keyword = request.args.get("keyword")
    assigned_to = request.args.get("assignedTo")
    work_item_type = request.args.get("type")
    planned_from = request.args.get("plannedFrom")
    planned_to = request.args.get("plannedTo")
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("pageSize", 20))

    try:
        todos = client.query_todos(
            project_id,
            state=state,
            keyword=keyword,
            assigned_to=assigned_to,
            work_item_type=work_item_type,
            planned_from=planned_from,
            planned_to=planned_to,
            page=page,
            page_size=page_size,
        )
        has_more = len(todos) == page_size
        return jsonify({"todos": todos, "hasMore": has_more})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/todos", methods=["GET"])
def list_all_todos() -> tuple:
    client = _require_client()
    state = request.args.get("state")
    keyword = request.args.get("keyword")
    assigned_to = request.args.get("assignedTo")
    work_item_type = request.args.get("type")
    planned_from = request.args.get("plannedFrom")
    planned_to = request.args.get("plannedTo")
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("pageSize", 20))

    try:
        projects = client.list_projects()
        app.logger.info("list_all_todos: %s projects", len(projects))
        aggregated = []

        # Query projects in parallel to maximize throughput
        from concurrent.futures import ThreadPoolExecutor, as_completed

        def fetch_proj(proj: Dict[str, str]) -> List[Dict[str, str]]:
            proj_id = proj.get("id")
            if not proj_id:
                return []
            try:
                items = client.query_todos(
                    proj_id,
                    state=state,
                    keyword=keyword,
                    assigned_to=assigned_to,
                    work_item_type=work_item_type,
                    planned_from=planned_from,
                    planned_to=planned_to,
                    page=1,
                    page_size=page_size,
                )
                app.logger.info("list_all_todos: %s items=%s", proj.get("name"), len(items))
                for item in items:
                    item["projectId"] = proj_id
                    item["projectName"] = proj.get("name")
                return items
            except AzureDevOpsError as exc:
                app.logger.warning("list_all_todos: %s AzureDevOpsError: %s", proj.get("name"), exc)
                return []
            except Exception as exc:
                app.logger.error("Failed to fetch project %s: %s", proj_id, exc)
                return []

        max_workers = min(8, max(len(projects), 1))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(fetch_proj, proj) for proj in projects]
            for future in as_completed(futures):
                aggregated.extend(future.result())

        aggregated.sort(key=lambda x: x.get("changedDate") or "", reverse=True)
        start = (page - 1) * page_size
        end = start + page_size
        slice_items = aggregated[start:end]
        has_more = end < len(aggregated)
        return jsonify({"todos": slice_items, "hasMore": has_more})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos", methods=["POST"])
def create_todo(project_id: str) -> tuple:
    client = _require_client()
    payload = request.get_json(force=True, silent=True) or {}

    if not payload.get("title"):
        return jsonify({"error": "title is required"}), 400

    # Some Azure DevOps processes require a custom "Requester" field.
    # If the frontend did not provide it explicitly, default it to the assignee
    # to satisfy the rule and avoid creation failures.
    if not payload.get("requester") and payload.get("assignedTo"):
        payload["requester"] = payload.get("assignedTo")

    try:
        todo = client.create_todo(project_id, payload)
        return jsonify({"todo": todo}), 201
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos/<int:item_id>", methods=["GET"])
def get_todo(project_id: str, item_id: int) -> tuple:
    client = _require_client()
    try:
        todo = client.get_todo(project_id, item_id)
        return jsonify({"todo": todo})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos/<int:item_id>", methods=["PATCH"])
def update_todo(project_id: str, item_id: int) -> tuple:
    client = _require_client()
    payload = request.get_json(force=True, silent=True) or {}

    try:
        todo = client.update_todo(project_id, item_id, payload)
        return jsonify({"todo": todo})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos/<int:item_id>", methods=["DELETE"])
def delete_todo(project_id: str, item_id: int) -> tuple:
    client = _require_client()
    try:
        todo = client.remove_todo(project_id, item_id)
        return jsonify({"todo": todo})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/tags", methods=["GET"])
def list_tags(project_id: str) -> tuple:
    client = _require_client()
    try:
        tags = client.list_tags(project_id)
        search = request.args.get("search")
        if search:
            tags = [tag for tag in tags if search.lower() in tag.lower()]
        return jsonify({"tags": tags})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/areas", methods=["GET"])
def list_areas(project_id: str) -> tuple:
    client = _require_client()
    try:
        areas = client.list_area_paths(project_id)
        search = request.args.get("search")
        if search:
            areas = [a for a in areas if search.lower() in a.lower()]
        return jsonify({"areas": areas})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/iterations", methods=["GET"])
def list_iterations(project_id: str) -> tuple:
    client = _require_client()
    try:
        iterations = client.list_iteration_paths(project_id)
        search = request.args.get("search")
        if search:
            iterations = [i for i in iterations if search.lower() in i.lower()]
        return jsonify({"iterations": iterations})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos/<int:item_id>/comments", methods=["GET"])
def list_comments(project_id: str, item_id: int) -> tuple:
    client = _require_client()
    try:
        comments = client.list_comments(project_id, item_id)
        return jsonify({"comments": comments})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/todos/<int:item_id>/comments", methods=["POST"])
def add_comment(project_id: str, item_id: int) -> tuple:
    client = _require_client()
    data = request.get_json(force=True, silent=True) or {}
    text = data.get("text")
    if not text:
        return jsonify({"error": "text is required"}), 400
    try:
        comment = client.add_comment(project_id, item_id, text)
        return jsonify({"comment": comment}), 201
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/projects/<project_id>/attachments", methods=["POST"])
def upload_attachment(project_id: str) -> tuple:
    """
    Accepts an image file and uploads it to Azure DevOps as a work item
    attachment, returning the attachment URL that can be used inside
    the HTML description.
    """
    client = _require_client()
    if "file" not in request.files:
        return jsonify({"error": "file is required"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "file name is required"}), 400

    content = file.read()
    content_type = file.mimetype or "application/octet-stream"
    try:
        url = client.upload_attachment(project_id, content, file.filename, content_type)
        return jsonify({"url": url})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.route("/api/attachments/proxy", methods=["GET"])
def proxy_attachment() -> tuple:
    """
    Proxy Azure DevOps attachment URLs so the browser can display images
    without exposing PAT credentials directly to the client.
    """
    client = _require_client()
    attachment_url = request.args.get("url")
    if not attachment_url:
        return jsonify({"error": "url is required"}), 400
    try:
        content, content_type = client.download_attachment(attachment_url)
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500
    resp = make_response(content)
    resp.headers["Content-Type"] = content_type or "application/octet-stream"
    resp.headers["Cache-Control"] = "private, max-age=60"
    return resp


@app.route("/api/identities", methods=["GET"])
def search_identities() -> tuple:
    client = _require_client()
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"identities": []})
    try:
        identities = client.search_identities(query)
        return jsonify({"identities": identities})
    except AzureDevOpsError as exc:
        return jsonify({"error": str(exc)}), exc.status_code or 500


@app.errorhandler(AzureDevOpsAuthError)
def handle_auth_error(error: AzureDevOpsAuthError):
    return jsonify({"error": str(error)}), error.status_code or 401


@app.errorhandler(Exception)
def handle_generic_error(error: Exception):
    return jsonify({"error": str(error)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
