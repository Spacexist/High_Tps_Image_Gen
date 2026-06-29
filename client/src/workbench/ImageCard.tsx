import type { WorkbenchImage } from "../models";
import { absoluteApiUrl } from "../request/api";
import { downloadResult } from "../result/download";
import { statusLabel } from "../result/status";

interface Props {
  blockId: string;
  image: WorkbenchImage;
  displayNumber: number;
  disabled: boolean;
  onPromptChange: (imageId: string, prompt: string) => void;
  onRetry: () => void;
}

export function ImageCard({
  blockId,
  image,
  displayNumber,
  disabled,
  onPromptChange,
  onRetry,
}: Props) {
  // 完成态也允许单张重新提交；pending/running 时禁用，避免同一图片重复入队。
  const canGenerate = ["ready", "completed", "failed", "cancelled"].includes(image.state.status);
  const number = String(displayNumber).padStart(2, "0");
  return (
    <article className="image-card">
      <div className="image-card__top">
        <span className="image-id">IMAGE {number}</span>
        <span className={`status status--${image.state.status}`}>{statusLabel[image.state.status]}</span>
      </div>

      <div className="image-pair">
        <figure>
          <img src={absoluteApiUrl(image.inputUrl)} alt={`图片 ${number} 原图`} />
          <figcaption>INPUT</figcaption>
        </figure>
        <figure className={!image.outputUrl ? "image-empty" : ""}>
          {image.outputUrl
            ? <img src={absoluteApiUrl(image.outputUrl)} alt={`图片 ${number} 结果`} />
            : <div className="empty-output">等待结果</div>}
          <figcaption>OUTPUT</figcaption>
        </figure>
      </div>

      <label className="field">
        <span>单图 Prompt（留空继承 Block）</span>
        <textarea
          rows={3}
          defaultValue={image.promptOverride}
          disabled={disabled}
          onBlur={(event) => onPromptChange(image.imageId, event.currentTarget.value)}
        />
      </label>

      {image.state.error && <p className="error-text">{image.state.error.message}</p>}
      <div className="image-actions">
        {canGenerate && (
          <button className="button button--small" disabled={disabled} onClick={onRetry}>
            {image.state.status === "ready" ? "生成" : "重新生成"}
          </button>
        )}
        {image.outputUrl && (
          <button
            className="button button--ghost"
            onClick={() => downloadResult(image.outputUrl!, `${blockId}-${image.imageId}`)}
          >
            下载
          </button>
        )}
      </div>
    </article>
  );
}
