import type { KeySource, PoolSnapshot } from "./types";

interface Props {
  sources: KeySource[];
  snapshot: PoolSnapshot;
}

export function PoolMap({ sources, snapshot }: Props) {
  return (
    <section className="core-section pool-map">
      <div className="section-heading">
        <div><span>PHYSICAL KEYPOOL</span><h2>运行时副本</h2></div>
        <small>{snapshot.total} COPIES {snapshot.truncated ? `· SHOWING ${snapshot.items.length}` : ""}</small>
      </div>
      {!sources.length ? (
        <div className="core-empty">注册原始 Key 后，这里会出现具有唯一 keyID 的并发副本。</div>
      ) : (
        <div className="pool-source-list">
          {sources.map((source) => {
            const copies = snapshot.items.filter((copy) => copy.sourceKeyId === source.id);
            const inactive = !source.enabled || !source.healthy;
            return (
              <div className="pool-source" key={source.id}>
                <header>
                  <div><strong>{source.name}</strong><code>{source.id}</code></div>
                  <span>{source.pool.available} FREE · {source.pool.leased} LEASED · CONFIG {source.concurrency}</span>
                </header>
                <div className="pool-copy-grid">
                  {copies.slice(0, 120).map((copy) => (
                    <div className={`pool-copy pool-copy--${copy.status}`} key={copy.keyID} title={copy.models.join(", ")}>
                      <span />
                      <code>{copy.keyID}</code>
                      <b>{copy.status.toUpperCase()}</b>
                    </div>
                  ))}
                  {inactive && Array.from({ length: Math.min(source.concurrency, 120) }, (_, index) => (
                    <div className="pool-copy pool-copy--offline" key={`${source.id}-offline-${index}`}>
                      <span />
                      <code>{source.id}:—:{index + 1}</code>
                      <b>{source.enabled ? "UNHEALTHY" : "DISABLED"}</b>
                    </div>
                  ))}
                  {!inactive && copies.length === 0 && <div className="core-empty core-empty--small">等待 Pool 快照…</div>}
                  {(copies.length > 120 || source.concurrency > 120) && <div className="pool-overflow">+ MORE COPIES</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
