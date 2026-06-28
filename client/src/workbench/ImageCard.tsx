import type { WorkbenchImage } from "../models";
import { absoluteApiUrl } from "../request/api";
import { downloadResult } from "../result/download";
import { statusLabel } from "../result/status";

interface Props {
  blockId: string;
  image: WorkbenchImage;
  disabled: boolean;
  onPromptChange: (imageId: string, prompt: string) => void;
  onRetry: () => void;
}

export function ImageCard({ blockId, image, disabled, onPromptChange, onRetry }: Props) {
  const canRetry = ["ready", "failed", "cancelled"].includes(image.state.status);
  return (
    <article className="image-card">
      <div className="image-card__top">
        <span className="image-id">{image.imageId}</span>
        <span className={`status status--${image.state.status}`}>{statusLabel[image.state.status]}</span>
      </div>

      <div className="image-pair">
        <figure>
          <img src={absoluteApiUrl(image.inputUrl)} alt={`${image.imageId} 原图`} />
          <figcaption>INPUT</figcaption>
        </figure>
        <figure className={!image.outputUrl ? "image-empty" : ""}>
          {image.outputUrl
            ? <img src={absoluteApiUrl(image.outputUrl)} alt={`${image.imageId} 结果`} />
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
        <span className="attempts">尝试 {image.state.attempts} 次</span>
        {image.outputUrl && (
          <button
            className="button button--ghost"
            onClick={() => downloadResult(image.outputUrl!, `${blockId}-${image.imageId}`)}
          >
            下载
          </button>
        )}
        {canRetry && (
          <button className="button button--small" disabled={disabled} onClick={onRetry}>
            {image.state.status === "ready" ? "生成" : "重试"}
          </button>
        )}
      </div>
    </article>
  );
}
