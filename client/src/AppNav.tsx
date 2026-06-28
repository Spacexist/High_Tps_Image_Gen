export type AppPage = "workbench" | "core";

interface Props {
  page: AppPage;
  onChange: (page: AppPage) => void;
}

// 工作台与后台控制面板共享一个前端，通过 hash 保留可复制的页面地址。
export function AppNav({ page, onChange }: Props) {
  return (
    <nav className="app-nav" aria-label="Main navigation">
      <button className={page === "workbench" ? "is-active" : ""} onClick={() => onChange("workbench")}>
        <span>01</span> WORKBENCH
      </button>
      <button className={page === "core" ? "is-active" : ""} onClick={() => onChange("core")}>
        <span>02</span> CORE CONTROL
      </button>
      <div className="app-nav__line" />
      <small>LOCAL ADMIN UI</small>
    </nav>
  );
}
