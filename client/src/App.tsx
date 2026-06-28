import { useEffect, useState } from "react";
import type { RuntimeConfig, WorkbenchSnapshot } from "./models";
import { loadConfig } from "./load/loadConfig";
import { apiJson, configureApi } from "./request/api";
import { Workbench } from "./workbench/Workbench";
import { AppNav, type AppPage } from "./AppNav";
import { CoreDashboard } from "./core/CoreDashboard";
import "./core/core.css";

function pageFromHash(): AppPage {
  return window.location.hash === "#core" ? "core" : "workbench";
}

export default function App() {
  const [ready, setReady] = useState<{ config: RuntimeConfig; snapshot: WorkbenchSnapshot } | null>(null);
  const [page, setPage] = useState<AppPage>(pageFromHash);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const config = await loadConfig();
        configureApi(config);
        const snapshot = await apiJson<WorkbenchSnapshot>("/api/workbench");
        document.title = config.ui.title;
        setReady({ config, snapshot });
      } catch (reason) {
        setError((reason as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    const update = () => setPage(pageFromHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  function navigate(nextPage: AppPage) {
    window.location.hash = nextPage === "core" ? "core" : "";
    setPage(nextPage);
  }

  if (error) {
    return (
      <div className="boot-screen boot-screen--error">
        <strong>工作台连接失败</strong>
        <p>{error}</p>
        <small>请确认后端已运行，并检查 client/config.json 的服务器地址。</small>
      </div>
    );
  }
  if (!ready) return <div className="boot-screen"><span className="loader" />正在连接 Workbench 与 Core…</div>;

  return (
    <>
      <AppNav page={page} onChange={navigate} />
      {page === "core"
        ? <CoreDashboard config={ready.config} />
        : <Workbench config={ready.config} initial={ready.snapshot} />}
    </>
  );
}
