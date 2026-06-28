import { useState, type FormEvent } from "react";
import type { CreateKeyInput } from "./types";

interface Props {
  defaultModel: string;
  busy: boolean;
  onSubmit: (input: CreateKeyInput) => Promise<void>;
}

export function KeyForm({ defaultModel, busy, onSubmit }: Props) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(defaultModel);
  const [concurrency, setConcurrency] = useState(1);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSubmit({
      id: id.trim() || undefined,
      name: name.trim() || id.trim() || "Image API Key",
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models: models.split(",").map((item) => item.trim()).filter(Boolean),
      concurrency,
      enabled: true,
    });
    // 注册成功后清除秘密字段，避免 API Key 长时间停留在 DOM 中。
    setApiKey("");
    setId("");
    setName("");
  }

  return (
    <form className="key-form" onSubmit={(event) => void submit(event)}>
      <div className="section-heading">
        <div><span>KEY REGISTRATION</span><h2>注册原始 Key</h2></div>
        <small>保存一次 · 动态复制</small>
      </div>
      <div className="key-form__grid">
        <label><span>ID（可留空）</span><input value={id} onChange={(event) => setId(event.target.value)} placeholder="openai-primary" /></label>
        <label><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Primary Image Key" /></label>
        <label className="key-form__wide"><span>BASE URL</span><input required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
        <label className="key-form__wide"><span>API KEY</span><input required type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-••••••••••••" /></label>
        <label><span>MODELS（逗号分隔）</span><input required value={models} onChange={(event) => setModels(event.target.value)} /></label>
        <label><span>CONCURRENCY</span><input required min={1} max={10000} type="number" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} /></label>
      </div>
      <div className="key-form__footer">
        <p>注册后将立即生成 <strong>{concurrency}</strong> 个 API Key 相同、keyID 唯一的物理副本。</p>
        <button className="button button--primary" disabled={busy || !apiKey.trim()}>{busy ? "正在注册…" : "注册并构建 KeyPool"}</button>
      </div>
    </form>
  );
}
