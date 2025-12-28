import { createContext, useContext, useMemo, useState } from "react";

type Language = "en" | "zh";

type I18nContextValue = {
  language: Language;
  toggleLanguage: () => void;
  t: (key: string, fallback?: string) => string;
};

const translations: Record<Language, Record<string, string>> = {
  en: {
    "app.brand": "Pico Project IT Project Manage",
    "app.backToProjects": "Back to Projects",
    "app.logout": "Logout",
    "app.pleaseSignIn": "Please sign in",
    "app.orgLabel": "Org",
    "app.languageButton": "中/EN",
    "allTodos.title": "All Projects - To-Dos",
    "allTodos.todoSuffix": "To-Dos",
    "allTodos.projectFallback": "Project To-Dos",
    "tabs.all": "All",
    "tabs.noStart": "No-Start",
    "tabs.onGoing": "On-Going",
    "tabs.completed": "Completed",
    "filters.searchTitle": "Search title",
    "filters.assigned": "Assigned to",
    "filters.state": "State",
    "filters.workItemType": "Work item type",
    "filters.project": "Project",
    "filters.plannedFrom": "Planned start from",
    "filters.plannedTo": "Planned start to",
    "filters.closedFrom": "Closed from",
    "filters.closedTo": "Closed to",
    "filters.today": "Today",
    "filters.thisWeek": "This Week",
    "filters.nextWeek": "Next Week",
    "filters.lastWeek": "Last Week",
    "filters.twoWeeksAgo": "Two Weeks Ago",
    "filters.thisMonth": "This Month",
    "filters.clear": "Clear Filters",
    "buttons.refresh": "Refresh",
    "buttons.newTodo": "New To-Do",
    "table.assignedTo": "Assigned To",
    "table.priority": "Priority",
    "table.project": "Project",
    "table.parent": "Parent",
    "table.title": "Title",
    "table.type": "Type",
    "table.discussion": "Discussion",
    "table.targetDate": "Target Date",
    "table.lastUpdated": "Last Updated",
    "table.actions": "Actions",
    "table.advance": "Advance",
    "table.noDiscussion": "No discussion",
    "metrics.totalEffort": "Total Effort",
    "views.list": "List View",
    "views.gantt": "Gantt View",
    "drawer.title.edit": "Edit To-Do",
    "drawer.title.create": "Create To-Do",
    "drawer.buttons.viewDevOps": "View in DevOps",
    "drawer.buttons.cancel": "Cancel",
    "drawer.buttons.temporarySave": "Temporary Save",
    "drawer.buttons.save": "Save",
    "drawer.buttons.create": "Create",
    "form.fields.project": "Project",
    "form.fields.title": "Title",
    "form.fields.workItemType": "Work Item Type",
    "form.fields.parent": "Parent",
    "form.fields.assignedTo": "Assigned To",
    "form.fields.state": "State",
    "form.fields.priority": "Priority",
    "form.fields.originalEstimate": "Original Estimate",
    "form.fields.plannedStart": "Planned Start Date",
    "form.fields.targetDate": "Target Date",
    "form.fields.description": "Description",
    "form.fields.area": "Area",
    "form.fields.iteration": "Iteration",
    "form.fields.tags": "Tags",
    "form.fields.addComment": "Add Comment",
    "form.fields.discussion": "Discussion",
    "form.placeholders.project": "Select project",
    "form.placeholders.workItemType": "Select type",
    "form.placeholders.parent": "Select parent",
    "form.placeholders.state": "Select state",
    "form.placeholders.priority": "Select priority",
    "form.placeholders.description": "Rich text: paste images, add links",
    "form.placeholders.area": "Select area",
    "form.placeholders.iteration": "Select iteration",
    "form.placeholders.tags": "Add tags",
    "form.placeholders.comment": "Add a comment",
    "form.placeholders.searchUsers": "Search users",
    "form.messages.selectProjectFirst": "Please select project first",
    "form.messages.emptyComment": "Comment is empty",
    "form.buttons.mention": "@ Mention",
    "form.buttons.post": "Post",
    "form.text.searching": "Searching...",
    "form.text.noMatches": "No matches",
    "form.text.loading": "Loading...",
    "form.text.noComments": "No comments",
    "projects.title": "Projects",
    "projects.buttons.refresh": "Refresh",
    "projects.buttons.allTodos": "All To-Dos",
    "projects.buttons.select": "Select project",
    "projects.columns.name": "Name",
    "projects.columns.description": "Description",
    "projects.columns.state": "State",
    "projects.columns.actions": "Actions",
    "projects.empty": "No projects found for this organization.",
  },
  zh: {
    "app.brand": "Pico 项目管理",
    "app.backToProjects": "返回项目列表",
    "app.logout": "退出登录",
    "app.pleaseSignIn": "请先登录",
    "app.orgLabel": "组织",
    "app.languageButton": "中/EN",
    "allTodos.title": "所有项目 - 待办",
    "allTodos.todoSuffix": "待办",
    "allTodos.projectFallback": "项目待办",
    "tabs.all": "全部",
    "tabs.noStart": "未开始",
    "tabs.onGoing": "进行中",
    "tabs.completed": "已完成",
    "filters.searchTitle": "搜索标题",
    "filters.assigned": "负责人",
    "filters.state": "状态",
    "filters.workItemType": "工作项类型",
    "filters.project": "项目",
    "filters.plannedFrom": "计划开始（起）",
    "filters.plannedTo": "计划开始（止）",
    "filters.closedFrom": "关闭时间（起）",
    "filters.closedTo": "关闭时间（止）",
    "filters.today": "今天",
    "filters.thisWeek": "本周",
    "filters.nextWeek": "下周",
    "filters.lastWeek": "上周",
    "filters.twoWeeksAgo": "上上周",
    "filters.thisMonth": "本月",
    "filters.clear": "清除筛选",
    "buttons.refresh": "刷新",
    "buttons.newTodo": "新增 To-Do",
    "table.assignedTo": "负责人",
    "table.priority": "优先级",
    "table.project": "项目",
    "table.parent": "父级",
    "table.title": "标题",
    "table.type": "类型",
    "table.discussion": "讨论",
    "table.targetDate": "预计完成日期",
    "table.lastUpdated": "最后更新时间",
    "table.actions": "操作",
    "table.advance": "推进",
    "table.noDiscussion": "暂无讨论",
    "metrics.totalEffort": "总工时",
    "views.list": "列表视图",
    "views.gantt": "甘特图视图",
    "drawer.title.edit": "编辑 To-Do",
    "drawer.title.create": "创建 To-Do",
    "drawer.buttons.viewDevOps": "在 DevOps 中查看",
    "drawer.buttons.cancel": "取消",
    "drawer.buttons.temporarySave": "临时保存",
    "drawer.buttons.save": "保存",
    "drawer.buttons.create": "创建",
    "form.fields.project": "项目",
    "form.fields.title": "标题",
    "form.fields.workItemType": "工作项类型",
    "form.fields.parent": "父级",
    "form.fields.assignedTo": "负责人",
    "form.fields.state": "状态",
    "form.fields.priority": "优先级",
    "form.fields.originalEstimate": "预计工时",
    "form.fields.plannedStart": "计划开始日期",
    "form.fields.targetDate": "预计完成日期",
    "form.fields.description": "描述",
    "form.fields.area": "区域",
    "form.fields.iteration": "迭代",
    "form.fields.tags": "标签",
    "form.fields.addComment": "新增评论",
    "form.fields.discussion": "讨论",
    "form.placeholders.project": "选择项目",
    "form.placeholders.workItemType": "选择类型",
    "form.placeholders.parent": "选择父级",
    "form.placeholders.state": "选择状态",
    "form.placeholders.priority": "选择优先级",
    "form.placeholders.description": "富文本：可粘贴图片、添加链接",
    "form.placeholders.area": "选择区域",
    "form.placeholders.iteration": "选择迭代",
    "form.placeholders.tags": "添加标签",
    "form.placeholders.comment": "添加评论",
    "form.placeholders.searchUsers": "搜索人员",
    "form.messages.selectProjectFirst": "请先选择项目",
    "form.messages.emptyComment": "评论内容为空",
    "form.buttons.mention": "@ 提及",
    "form.buttons.post": "发布",
    "form.text.searching": "搜索中...",
    "form.text.noMatches": "无匹配结果",
    "form.text.loading": "加载中...",
    "form.text.noComments": "暂无评论",
    "projects.title": "项目列表",
    "projects.buttons.refresh": "刷新",
    "projects.buttons.allTodos": "全部待办",
    "projects.buttons.select": "进入项目",
    "projects.columns.name": "名称",
    "projects.columns.description": "描述",
    "projects.columns.state": "状态",
    "projects.columns.actions": "操作",
    "projects.empty": "该组织下暂无项目。",
  },
};

const I18nContext = createContext<I18nContextValue>({
  language: "en",
  toggleLanguage: () => undefined,
  t: (key: string, fallback?: string) => fallback || key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("app-language");
      if (stored === "zh" || stored === "en") {
        return stored;
      }
    }
    return "en";
  });

  const toggleLanguage = () => {
    setLanguage((prev) => {
      const next: Language = prev === "en" ? "zh" : "en";
      if (typeof window !== "undefined") {
        window.localStorage.setItem("app-language", next);
      }
      return next;
    });
  };

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      toggleLanguage,
      t: (key: string, fallback?: string) => translations[language][key] || fallback || key,
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
