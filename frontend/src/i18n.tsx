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
    "table.project": "项目",
    "table.parent": "父级",
    "table.title": "标题",
    "table.type": "类型",
    "table.discussion": "讨论",
    "table.targetDate": "目标日期",
    "table.lastUpdated": "最后更新时间",
    "table.actions": "操作",
    "table.advance": "推进",
    "table.noDiscussion": "暂无讨论",
    "metrics.totalEffort": "总工时",
    "views.list": "列表视图",
    "views.gantt": "甘特图视图",
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
