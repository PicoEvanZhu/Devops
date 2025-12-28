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
  originalEstimate?: number;
  remaining?: number;
  tags?: string[];
  changedDate?: string;
  createdDate?: string;
   closedDate?: string;
  plannedStartDate?: string;
  targetDate?: string;
  areaPath?: string;
  iterationPath?: string;
  projectId?: string;
  projectName?: string;
  parentId?: number;
};

export type SessionInfo = {
  authenticated: boolean;
  organization?: string;
  user?: {
    displayName?: string;
    email?: string;
    uniqueName?: string;
  } | null;
};

export type Identity = {
  id?: string;
  descriptor?: string;
  displayName?: string;
  uniqueName?: string;
  mail?: string;
};
