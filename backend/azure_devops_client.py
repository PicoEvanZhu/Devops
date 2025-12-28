import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)


class AzureDevOpsError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class AzureDevOpsAuthError(AzureDevOpsError):
    pass


class AzureDevOpsClient:
    """
    Thin wrapper around Azure DevOps REST API for projects and work items.
    """

    API_VERSION = "7.1"

    def __init__(self, organization: str, pat: str) -> None:
        if not organization or not pat:
            raise ValueError("organization and pat are required")
        self.organization = organization
        self.pat = pat
        self.base_url = f"https://dev.azure.com/{organization}"
        self.auth = ("", pat)
        # Reuse HTTP session to reduce TLS handshakes and speed up concurrent calls
        self.session = requests.Session()

    def list_projects(self, top: Optional[int] = None) -> List[Dict[str, Any]]:
        projects: List[Dict[str, Any]] = []
        continuation_token: Optional[str] = None

        while True:
            params: Dict[str, Any] = {"api-version": self.API_VERSION}
            if continuation_token:
                params["continuationToken"] = continuation_token
            if top is not None:
                params["$top"] = max(top - len(projects), 0)

            response = self._request("GET", f"{self.base_url}/_apis/projects", params=params)
            data = response.json()
            projects.extend(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "description": item.get("description"),
                    "state": item.get("state"),
                }
                for item in data.get("value", [])
            )

            continuation_token = response.headers.get("x-ms-continuationtoken") or data.get("continuationToken")
            if not continuation_token or (top is not None and len(projects) >= top):
                break

        return projects[:top] if top is not None else projects

    def query_todos(
        self,
        project: str,
        *,
        state: Optional[str] = None,
        keyword: Optional[str] = None,
        assigned_to: Optional[str] = None,
        work_item_type: Optional[str] = None,
        planned_from: Optional[str] = None,
        planned_to: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
    ) -> List[Dict[str, Any]]:
        page = max(page, 1)
        page_size = max(min(page_size, 200), 1)  # Azure DevOps limits to 200 per call

        # Special sentinel from frontend: exclude Epics but don't restrict other types
        exclude_epic = False
        if work_item_type == "__NO_EPIC__":
            exclude_epic = True
            work_item_type = None

        clauses = [
            "[System.TeamProject] = @project",
            "[System.State] <> 'Removed'",
        ]

        if work_item_type:
            types = [t.strip() for t in work_item_type.split(",") if t.strip()]
            if types:
                if len(types) == 1:
                    clauses.append(f"[System.WorkItemType] = '{types[0]}'")
                else:
                    joined = ", ".join(f"'{t}'" for t in types)
                    clauses.append(f"[System.WorkItemType] IN ({joined})")
        if exclude_epic:
            clauses.append("[System.WorkItemType] <> 'Epic'")

        if state:
            if "," in state:
                states = [s.strip() for s in state.split(",") if s.strip()]
                if states:
                    joined = ", ".join(f"'{s}'" for s in states)
                    clauses.append(f"[System.State] IN ({joined})")
            else:
                clauses.append(f"[System.State] = '{state}'")
        if assigned_to:
            clauses.append(f"[System.AssignedTo] CONTAINS '{assigned_to}'")
        if keyword:
            keyword_str = str(keyword).strip()
            if keyword_str.isdigit():
                clauses.append(f"([System.Id] = {keyword_str} OR [System.Title] CONTAINS '{keyword_str}')")
            else:
                clauses.append(f"[System.Title] CONTAINS '{keyword_str}'")
        if planned_from:
            clauses.append(f"[Microsoft.VSTS.Scheduling.StartDate] >= '{planned_from}'")
        if planned_to:
            clauses.append(f"[Microsoft.VSTS.Scheduling.StartDate] <= '{planned_to}'")

        wiql = (
            "SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo], "
            "[System.Tags], [Microsoft.VSTS.Common.Priority], [System.ChangedDate], "
            "[System.Description], [System.WorkItemType], [System.CreatedDate], [System.TeamProject], "
            "[System.AreaPath], [System.IterationPath], "
            "[Microsoft.VSTS.Scheduling.OriginalEstimate], [Microsoft.VSTS.Scheduling.RemainingWork], "
            "[Microsoft.VSTS.Scheduling.StartDate], [Microsoft.VSTS.Scheduling.FinishDate] "
            "FROM WorkItems WHERE "
            + " AND ".join(clauses)
            + " ORDER BY [System.ChangedDate] DESC"
        )

        try:
            wiql_resp = self._request(
                "POST",
                f"{self.base_url}/{project}/_apis/wit/wiql",
                params={"api-version": self.API_VERSION},
                json={"query": wiql},
            ).json()
        except AzureDevOpsError as exc:
            # If WIQL fails (often due to invalid type), retry once without type filter
            if exc.status_code == 400 and work_item_type:
                logger.warning("WIQL failed for project %s with types '%s', retrying without type", project, work_item_type)
                return self.query_todos(
                    project,
                    state=state,
                    keyword=keyword,
                    assigned_to=assigned_to,
                    work_item_type=None,
                    page=page,
                    page_size=page_size,
                )
            logger.warning("WIQL query failed for project %s: %s", project, exc)
            return []

        work_items = wiql_resp.get("workItems", [])
        skip = (page - 1) * page_size
        page_items = work_items[skip : skip + page_size]
        ids = [str(item.get("id")) for item in page_items if item.get("id")]
        if not ids:
            return []

        results: List[Dict[str, Any]] = []
        for chunk_ids in self._chunk(ids, 200):
            resp = self._request(
                "GET",
                f"{self.base_url}/{project}/_apis/wit/workitems",
                params={
                    "ids": ",".join(chunk_ids),
                    "api-version": self.API_VERSION,
                    "$expand": "relations",
                },
            ).json()
            for item in resp.get("value", []):
                results.append(self._map_work_item(item))

        # Ensure final sort by ChangedDate desc as a safeguard
        results.sort(key=lambda r: r.get("changedDate") or "", reverse=True)
        return results

    def create_todo(self, project: str, data: Dict[str, Any]) -> Dict[str, Any]:
        work_item_type = data.get("workItemType") or "User Story"
        body = self._build_patch_body(data, project)
        resp = self._request(
            "POST",
            f"{self.base_url}/{project}/_apis/wit/workitems/${work_item_type}",
            params={"api-version": self.API_VERSION},
            headers={"Content-Type": "application/json-patch+json"},
            json=body,
        )
        return self._map_work_item(resp.json())

    def get_todo(self, project: str, item_id: int) -> Dict[str, Any]:
        resp = self._request(
            "GET",
            f"{self.base_url}/{project}/_apis/wit/workitems/{item_id}",
            params={
                "api-version": self.API_VERSION,
                "$expand": "relations",
            },
        ).json()
        return self._map_work_item(resp)

    def update_todo(self, project: str, item_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        existing_parent_index: Optional[int] = None
        existing_parent_id: Optional[int] = None

        if "parentId" in data:
            try:
                current = self._request(
                    "GET",
                    f"{self.base_url}/{project}/_apis/wit/workitems/{item_id}",
                    params={"api-version": self.API_VERSION, "$expand": "relations"},
                ).json()
                for idx, rel in enumerate(current.get("relations", []) or []):
                    rel_name = rel.get("rel")
                    if rel_name and "Hierarchy-Reverse" in rel_name:
                        url = rel.get("url") or ""
                        if "/workItems/" in url:
                            try:
                                existing_parent_id = int(url.rsplit("/", 1)[-1])
                            except (TypeError, ValueError):
                                existing_parent_id = None
                        existing_parent_index = idx
                        break
            except Exception:
                # 读取现有父级失败时，保留其它字段更新逻辑
                existing_parent_index = None
                existing_parent_id = None

        body = self._build_patch_body(data, project, existing_parent_index, existing_parent_id)
        resp = self._request(
            "PATCH",
            f"{self.base_url}/{project}/_apis/wit/workitems/{item_id}",
            params={"api-version": self.API_VERSION},
            headers={"Content-Type": "application/json-patch+json"},
            json=body,
        )
        return self._map_work_item(resp.json())

    def remove_todo(self, project: str, item_id: int) -> Dict[str, Any]:
        body = [{"op": "add", "path": "/fields/System.State", "value": "Removed"}]
        resp = self._request(
            "PATCH",
            f"{self.base_url}/{project}/_apis/wit/workitems/{item_id}",
            params={"api-version": self.API_VERSION},
            headers={"Content-Type": "application/json-patch+json"},
            json=body,
        )
        return self._map_work_item(resp.json())

    def list_tags(self, project: str) -> List[str]:
        tags: List[str] = []
        continuation_token: Optional[str] = None

        while True:
            params: Dict[str, Any] = {"api-version": self.API_VERSION}
            if continuation_token:
                params["continuationToken"] = continuation_token

            response = self._request(
                "GET",
                f"{self.base_url}/{project}/_apis/wit/tags",
                params=params,
            )
            data = response.json()
            tags.extend(tag.get("name") for tag in data.get("value", []) if tag.get("name"))

            continuation_token = response.headers.get("x-ms-continuationtoken") or data.get("continuationToken")
            if not continuation_token:
                break

        # return unique sorted tags
        return sorted(set(tags))

    def list_area_paths(self, project: str) -> List[str]:
        url = f"{self.base_url}/{project}/_apis/wit/classificationnodes/areas"
        resp = self._request("GET", url, params={"api-version": self.API_VERSION, "$depth": 10}).json()
        return self._flatten_classification_nodes(resp)

    def list_iteration_paths(self, project: str) -> List[str]:
        url = f"{self.base_url}/{project}/_apis/wit/classificationnodes/iterations"
        resp = self._request("GET", url, params={"api-version": self.API_VERSION, "$depth": 10}).json()
        return self._flatten_classification_nodes(resp)

    def upload_attachment(self, project: str, content: bytes, filename: str, content_type: str) -> str:
        """
        Upload a simple attachment and return its URL that can be used inside
        HTML fields like System.Description.
        """
        url = f"{self.base_url}/{project}/_apis/wit/attachments"
        # Attachments endpoint is currently in preview API.
        # It only accepts application/octet-stream as content type, so we
        # force that regardless of the original file mime type.
        params = {"api-version": "7.1-preview.3", "fileName": filename}
        headers = {"Content-Type": "application/octet-stream"}
        resp = self._request("POST", url, params=params, headers=headers, data=content).json()
        return resp.get("url")

    def download_attachment(self, attachment_url: str) -> Tuple[bytes, str]:
        """
        Download an attachment from Azure DevOps and return (bytes, content_type).
        """
        if not attachment_url:
            raise AzureDevOpsError("attachment url is required", status_code=400)
        resp = self._request("GET", attachment_url, headers={"Accept": "*/*"})
        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        return resp.content, content_type

    def search_identities(self, query: str, top: int = 10) -> List[Dict[str, Any]]:
        if not query:
            return []
        url = f"https://vssps.dev.azure.com/{self.organization}/_apis/IdentityPicker/Identities"
        payload = {
            "query": query,
            "identityTypes": ["user"],
            "operationScopes": ["ims", "source"],
            "options": {
                "MinResults": 1,
                "MaxResults": max(top, 1),
                "ShowMru": False,
            },
            "properties": ["DisplayName", "Mail", "UserPrincipalName"],
        }
        resp = self._request(
            "POST",
            url,
            params={"api-version": "7.1-preview.1"},
            json=payload,
        ).json()
        identities: List[Dict[str, Any]] = []
        for result in resp.get("results", []):
            for identity in result.get("identities", []) or []:
                identities.append(
                    {
                        "id": identity.get("localId") or identity.get("entityId"),
                        "descriptor": identity.get("descriptor"),
                        "displayName": identity.get("friendlyDisplayName") or identity.get("displayName"),
                        "uniqueName": identity.get("signInAddress") or identity.get("uniqueName"),
                        "mail": identity.get("mail") or identity.get("signInAddress"),
                    }
                )
        return identities

    def get_current_profile(self) -> Dict[str, Any]:
        profile: Dict[str, Any] = {}
        try:
            url = "https://app.vssps.visualstudio.com/_apis/profile/profiles/me"
            resp = self._request("GET", url, params={"api-version": "7.1-preview.3"}).json()
            profile = {
                "displayName": resp.get("displayName"),
                "email": resp.get("emailAddress"),
                "uniqueName": resp.get("emailAddress"),
            }
        except AzureDevOpsError:
            profile = {}

        if profile.get("displayName"):
            return profile

        try:
            resp = self._request(
                "GET",
                f"{self.base_url}/_apis/connectionData",
                params={
                    "connectOptions": "IncludeServices",
                    "lastChangeId": -1,
                    "lastChangeId64": -1,
                    "api-version": "7.1-preview.1",
                },
            ).json()
            user = resp.get("authenticatedUser") or {}
            return {
                "displayName": user.get("displayName"),
                "email": user.get("mailAddress") or user.get("uniqueName"),
                "uniqueName": user.get("uniqueName"),
            }
        except AzureDevOpsError:
            return profile

    def _build_patch_body(
        self,
        data: Dict[str, Any],
        project: Optional[str] = None,
        existing_parent_index: Optional[int] = None,
        existing_parent_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        ops: List[Dict[str, Any]] = []
        mapping = {
            "title": "/fields/System.Title",
            "description": "/fields/System.Description",
            "state": "/fields/System.State",
            "priority": "/fields/Microsoft.VSTS.Common.Priority",
            "assignedTo": "/fields/System.AssignedTo",
            "areaPath": "/fields/System.AreaPath",
            "iterationPath": "/fields/System.IterationPath",
            "originalEstimate": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
            "remaining": "/fields/Microsoft.VSTS.Scheduling.RemainingWork",
            "plannedStartDate": "/fields/Microsoft.VSTS.Scheduling.StartDate",
            "targetDate": "/fields/Microsoft.VSTS.Scheduling.FinishDate",
            # Common custom field in this process – if it does not exist
            # in a given project, Azure DevOps will simply ignore it.
            "requester": "/fields/Custom.Requester",
        }

        for key, path in mapping.items():
            if key not in data:
                continue
            value = data.get(key)
            allow_none = key in ("plannedStartDate", "targetDate")
            if value is None and not allow_none:
                continue
            if key in ("areaPath", "iterationPath") and isinstance(value, str):
                # Azure DevOps expects tree paths without a leading slash/backslash
                value = self._normalize_tree_path(value)
                # Skip container-only roots like "\Area" or "\Iteration"
                lower_val = value.lower()
                if lower_val in ("area", "iteration") or lower_val.endswith("\\area") or lower_val.endswith("\\iteration"):
                    continue
                # Validate against known nodes to avoid invalid tree name errors
                if project:
                    try:
                        valid_paths = (
                            self.list_area_paths(project)
                            if key == "areaPath"
                            else self.list_iteration_paths(project)
                        )
                        valid_paths = [self._normalize_tree_path(p) for p in valid_paths]
                        if value not in valid_paths:
                            continue
                    except Exception:
                        # if validation fails, proceed without dropping to avoid masking other issues
                        pass
            ops.append({"op": "add", "path": path, "value": value})

        # Keep OriginalEstimate 和 RemainingWork 尽量同步：
        original = data.get("originalEstimate")
        remaining = data.get("remaining")
        state = str(data.get("state") or "").lower()
        is_closed = state in ("closed", "resolved")

        # 1) 如果提供了 OriginalEstimate 但没有提供 Remaining，则在「非关闭」状态下
        #    把 RemainingWork 设成相同的值；关闭状态不自动改写 Remaining。
        if original is not None and ("remaining" not in data or remaining is None) and not is_closed:
            ops.append(
                {
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Scheduling.RemainingWork",
                    "value": original,
                }
            )

        # 2) 反过来，如果只提供了 Remaining 而没有 OriginalEstimate，也把 OriginalEstimate 设成相同的值，
        #    避免 DevOps 里看到 Remaining 有值而 OriginalEstimate 为空。
        if remaining is not None and ("originalEstimate" not in data or original is None):
            ops.append(
                {
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
                    "value": remaining,
                }
            )

        if "tags" in data and data.get("tags") is not None:
            tags_value = data["tags"]
            if isinstance(tags_value, list):
                tags_value = "; ".join(tags_value)
            ops.append({"op": "add", "path": "/fields/System.Tags", "value": tags_value})

        if "parentId" in data:
            new_parent_raw = data.get("parentId")
            try:
                new_parent_id = int(new_parent_raw) if new_parent_raw is not None else None
            except (TypeError, ValueError):
                new_parent_id = None

            # null / None 表示清空父级
            if new_parent_id is None:
                if existing_parent_index is not None:
                    ops.append({"op": "remove", "path": f"/relations/{existing_parent_index}"})
            else:
                # 如果父级未变化，则不做任何操作
                if existing_parent_id == new_parent_id:
                    pass
                else:
                    # 如已有父级，先移除旧的再添加新的
                    if existing_parent_index is not None:
                        ops.append({"op": "remove", "path": f"/relations/{existing_parent_index}"})
                    parent_url = f"{self.base_url}/_apis/wit/workItems/{new_parent_id}"
                    ops.append(
                        {
                            "op": "add",
                            "path": "/relations/-",
                            "value": {
                                "rel": "System.LinkTypes.Hierarchy-Reverse",
                                "url": parent_url,
                                "attributes": {"name": "Parent"},
                            },
                        }
                    )
        return ops

    def _map_work_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        fields = item.get("fields", {})
        assigned = fields.get("System.AssignedTo")
        parent_id = None
        for rel in item.get("relations", []) or []:
          try:
            if rel.get("rel") and "Hierarchy-Reverse" in rel.get("rel"):
                url = rel.get("url") or ""
                if "/workItems/" in url:
                    parent_id = int(url.rsplit("/", 1)[-1])
                    break
          except Exception:
            continue
        area = fields.get("System.AreaPath")
        iteration = fields.get("System.IterationPath")
        if isinstance(area, str):
            area = self._normalize_tree_path(area)
        if isinstance(iteration, str):
            iteration = self._normalize_tree_path(iteration)
        return {
            "id": item.get("id"),
            "title": fields.get("System.Title"),
            "description": fields.get("System.Description"),
            "state": fields.get("System.State"),
            "workItemType": fields.get("System.WorkItemType"),
            "createdDate": fields.get("System.CreatedDate"),
            "closedDate": fields.get("Microsoft.VSTS.Common.ClosedDate"),
            "project": fields.get("System.TeamProject"),
            "areaPath": area,
            "iterationPath": iteration,
            "assignedTo": assigned.get("displayName") if isinstance(assigned, dict) else assigned,
            "assignedToAvatar": assigned.get("imageUrl") if isinstance(assigned, dict) else None,
            "priority": fields.get("Microsoft.VSTS.Common.Priority"),
            "originalEstimate": fields.get("Microsoft.VSTS.Scheduling.OriginalEstimate"),
            "remaining": fields.get("Microsoft.VSTS.Scheduling.RemainingWork"),
            "plannedStartDate": fields.get("Microsoft.VSTS.Scheduling.StartDate"),
            "targetDate": fields.get("Microsoft.VSTS.Scheduling.FinishDate"),
            "tags": self._split_tags(fields.get("System.Tags")),
            "changedDate": fields.get("System.ChangedDate"),
            "parentId": parent_id,
        }

    def _request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        headers = kwargs.pop("headers", {}) or {}
        response = self.session.request(method, url, headers=headers, auth=self.auth, timeout=20, **kwargs)

        if response.status_code in (401, 403):
            raise AzureDevOpsAuthError(f"Azure DevOps authentication failed ({response.status_code})", status_code=response.status_code)

        if response.status_code >= 400:
            message = response.json().get("message") if response.headers.get("Content-Type", "").startswith("application/json") else response.text
            raise AzureDevOpsError(f"{message or 'Azure DevOps API error'} (status {response.status_code})", status_code=response.status_code)

        return response

    def list_comments(self, project: str, work_item_id: int) -> List[Dict[str, Any]]:
        url = f"{self.base_url}/{project}/_apis/wit/workItems/{work_item_id}/comments"
        resp = self._request("GET", url, params={"api-version": "7.1-preview.3"}).json()
        comments: List[Dict[str, Any]] = []
        for c in resp.get("comments", []):
            author = c.get("revisedBy") or c.get("createdBy") or {}
            comments.append(
                {
                    "id": c.get("id"),
                    "text": c.get("text"),
                    "createdDate": c.get("createdDate"),
                    "createdBy": author.get("displayName") if isinstance(author, dict) else author,
                }
            )
        return comments

    def list_descendants(self, project: str, epic_id: int) -> List[Dict[str, Any]]:
        wiql = (
            "SELECT [System.Id] FROM WorkItemLinks WHERE "
            f"([Source].[System.Id] = {epic_id}) "
            "AND ([System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward') "
            "AND ([Target].[System.State] <> 'Removed') "
            "MODE (Recursive)"
        )
        resp = self._request(
            "POST",
            f"{self.base_url}/{project}/_apis/wit/wiql",
            params={"api-version": self.API_VERSION},
            json={"query": wiql},
        ).json()
        relations = resp.get("workItemRelations", [])
        ids = [str(rel.get("target", {}).get("id")) for rel in relations if rel.get("target")]
        ids = [i for i in ids if i]
        if not ids:
            return []
        results: List[Dict[str, Any]] = []
        for chunk_ids in self._chunk(ids, 200):
            items_resp = self._request(
                "GET",
                f"{self.base_url}/{project}/_apis/wit/workitems",
                params={
                    "ids": ",".join(chunk_ids),
                    "api-version": self.API_VERSION,
                    "$expand": "relations",
                },
            ).json()
            for item in items_resp.get("value", []):
                results.append(self._map_work_item(item))
        return results

    def add_comment(self, project: str, work_item_id: int, text: str) -> Dict[str, Any]:
        url = f"{self.base_url}/{project}/_apis/wit/workItems/{work_item_id}/comments"
        resp = self._request(
            "POST",
            url,
            params={"api-version": "7.1-preview.3"},
            headers={"Content-Type": "application/json"},
            json={"text": text},
        ).json()
        author = resp.get("revisedBy") or resp.get("createdBy") or {}
        return {
            "id": resp.get("id"),
            "text": resp.get("text"),
            "createdDate": resp.get("createdDate"),
            "createdBy": author.get("displayName") if isinstance(author, dict) else author,
        }

    @staticmethod
    def _split_tags(raw: Optional[str]) -> List[str]:
        if not raw:
            return []
        return [tag.strip() for tag in raw.split(";") if tag.strip()]

    @staticmethod
    def _chunk(items: List[str], size: int) -> List[List[str]]:
        return [items[i : i + size] for i in range(0, len(items), size)]

    @staticmethod
    def _flatten_classification_nodes(node: Dict[str, Any], base_path: Optional[str] = None) -> List[str]:
        paths: List[str] = []
        current_path = node.get("path") or (f"{base_path}\\{node.get('name')}" if base_path else node.get("name"))
        if current_path:
            current_path = AzureDevOpsClient._normalize_tree_path(current_path)
        if current_path:
            paths.append(current_path)
        for child in node.get("children", []) or []:
            paths.extend(AzureDevOpsClient._flatten_classification_nodes(child, current_path))
        return paths

    @staticmethod
    def _normalize_tree_path(path: str) -> str:
        """Remove leading slashes and drop container segments 'Area'/'Iteration' from classification paths."""
        cleaned = path.lstrip("\\/").strip()
        parts = cleaned.split("\\")
        if len(parts) > 1 and parts[1].lower() in ("area", "iteration"):
            parts.pop(1)
        return "\\".join(parts)
