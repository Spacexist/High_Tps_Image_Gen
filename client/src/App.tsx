import { useEffect, useState } from "react";
import type { RuntimeConfig, WorkbenchSnapshot } from "./models";
import { loadConfig } from "./load/loadConfig";
import { apiJson, configureApi } from "./request/api";
import { Workbench } from "./workbench/Workbench";

export default function App() {
  const [ready, setReady] = useState<{ config: RuntimeConfig; snapshot: WorkbenchSnapshot } | null>(null);
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

  if (error) {
    return (
      <div className="boot-screen boot-screen--error">
        <strong>工作台连接失败</strong>
        <p>{error}</p>
        <small>请确认后端已运行，并检查 client/config.json 的服务器地址。</small>
      </div>
    );
  }
  if (!ready) return <div className="boot-screen"><span className="loader" />正在恢复本地工作台…</div>;
  return <Workbench config={ready.config} initial={ready.snapshot} />;
}
