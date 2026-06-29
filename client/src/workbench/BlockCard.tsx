import type { WorkbenchBlock } from "../models";
import { buildTaskQueue } from "../request/taskQueue";
import { ImageCard } from "./ImageCard";

interface Props {
  block: WorkbenchBlock;
  disabled: boolean;
  onRunBlock: () => void;
  onBlockPromptChange: (prompt: string) => void;
  onImagePromptChange: (imageId: string, prompt: string) => void;
  onRetry: (imageId: string) => void;
}

export function BlockCard({
  block,
  disabled,
  onRunBlock,
  onBlockPromptChange,
  onImagePromptChange,
  onRetry,
}: Props) {
  const completed = block.images.filter((image) => image.state.status === "completed").length;
  const runnable = buildTaskQueue([block]).length;
  return (
    <section className="block-card">
      <header className="block-card__header">
        <div>
          <span className="eyebrow">{block.blockId}</span>
          <h2>{block.listing}</h2>
        </div>
        <div className="block-card__actions">
          <button
            className="button button--primary"
            disabled={disabled || runnable === 0}
            onClick={onRunBlock}
          >
            开始执行 ({runnable})
          </button>
          <div className="block-progress">
            <strong>{completed}</strong>
            <span>/ {block.images.length}</span>
          </div>
        </div>
      </header>

      <label className="field field--block">
        <span>Block Prompt</span>
        <textarea
          rows={3}
          defaultValue={block.prompt}
          disabled={disabled}
          onBlur={(event) => onBlockPromptChange(event.currentTarget.value)}
        />
      </label>

      <div className="image-grid">
        {block.images.map((image, index) => (
          <ImageCard
            key={image.imageId}
            blockId={block.blockId}
            image={image}
            // 服务端真实 imageId 与这里的两位编号完全一致。
            displayNumber={index + 1}
            disabled={disabled}
            onPromptChange={onImagePromptChange}
            onRetry={() => onRetry(image.imageId)}
          />
        ))}
      </div>
    </section>
  );
}
