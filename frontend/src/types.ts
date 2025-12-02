export type Project = {
  id: string;
  name: string;
  description?: string;
  state?: string;
};

export type TodoItem = {
  id: number;
  title?: string;
  description?: string;
  state?: string;
  workItemType?: string;
  assignedTo?: string;
  priority?: number;
  effort?: number;
  tags?: string[];
  changedDate?: string;
  createdDate?: string;
  areaPath?: string;
  iterationPath?: string;
};

export type SessionInfo = {
  authenticated: boolean;
  organization?: string;
};
