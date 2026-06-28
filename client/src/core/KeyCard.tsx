import { useEffect, useState } from "react";
import type { KeySource } from "./types";

interface Props {
  source: KeySource;
  busy: boolean;
  onConcurrency: (source: KeySource, concurrency: number) => Promise<void>;
  onToggle: (source: KeySource) => Promise<void>;
  onHealthTest: (source: KeySource) => Promise<void>;
  onDelete: (source: KeySource) => Promise<void>;
}

export function KeyCard({ source, busy, onConcurrency, onToggle, onHealthTest, onDelete }: Props) {
  const [concurrency, setConcurrency] = useState(source.concurrency);

  useEffect(() => setConcurrency(source.concurrency), [source.concurrency]);

  const state = !source.enabled ? "disabled" : source.healthy ? "healthy" : "unhealthy";
  const checkedAt = source.lastCheckedAt
    ? new Date(source.lastCheckedAt).toLocaleString("zh-CN", { hour12: false })
    : "尚未检查";

  return (
    <article className={`key-source-card key-source-card--${state}`}>
      <header>
        <div>
          <span className="key-source-card__id">{source.id} · GEN {source.generation}</span>
          <h3>{source.name}</h3>
        </div>
        <span className={`source-state source-state--${state}`}>{state.toUpperCase()}</span>
      </header>

      <div className="key-source-card__meta">
        <code>{source.apiKey}</code>
        <span title={source.baseUrl}>{source.baseUrl}</span>
      </div>
      <div className="model-tags">{source.models.map((model) => <code key={model}>{model}</code>)}</div>

      <div className="key-pool-numbers">
        <div><span>AVAILABLE</span><strong>{source.pool.available}</strong></div>
        <div><span>LEASED</span><strong>{source.pool.leased}</strong></div>
        <div><span>POOL</span><strong>{source.pool.total}/{source.concurrency}</strong></div>
      </div>

      <div className="concurrency-editor">
        <label><span>CONCURRENCY</span><input min={1} max={10000} type="number" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} /></label>
        <button className="button button--small" disabled={busy || concurrency === source.concurrency} onClick={() => void onConcurrency(source, concurrency)}>重建 Pool</button>
      </div>

      <footer>
        <div className="health-copy">
          <span>HEALTH · {checkedAt}</span>
          {source.lastError && <small>{source.lastError}</small>}
        </div>
        <div className="key-card-actions">
          <button className="button button--ghost" disabled={busy || !source.enabled} onClick={() => void onHealthTest(source)}>健康检查</button>
          <button className="button" disabled={busy} onClick={() => void onToggle(source)}>{source.enabled ? "停用" : "启用"}</button>
          <button className="button button--danger-inline" disabled={busy} onClick={() => void onDelete(source)}>删除</button>
        </div>
      </footer>
    </article>
  );
}
