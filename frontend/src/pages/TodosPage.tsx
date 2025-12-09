import { Navigate, useParams } from "react-router-dom";

import { AllTodosPage } from "./AllTodosPage";

export function TodosPage() {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <Navigate to="/todos" replace />;
  }

  return <AllTodosPage forcedProjectId={projectId} hideProjectSelector />;
}
