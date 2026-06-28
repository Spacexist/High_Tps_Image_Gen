import type { WorkbenchBlock } from "../models";
import { ImageCard } from "./ImageCard";

interface Props {
  block: WorkbenchBlock;
  disabled: boolean;
  onBlockPromptChange: (prompt: string) => void;
  onImagePromptChange: (imageId: string, prompt: string) => void;
  onRetry: (imageId: string) => void;
}

export function BlockCard({
  block,
  disabled,
  onBlockPromptChange,
  onImagePromptChange,
  onRetry,
}: Props) {
  const completed = block.images.filter((image) => image.state.status === "completed").length;
  return (
    <section className="block-card">
      <header className="block-card__header">
        <div>
          <span className="eyebrow">{block.blockId}</span>
          <h2>{block.listing}</h2>
        </div>
        <div className="block-progress">
          <strong>{completed}</strong>
          <span>/ {block.images.length}</span>
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
        {block.images.map((image) => (
          <ImageCard
            key={image.imageId}
            blockId={block.blockId}
            image={image}
            disabled={disabled}
            onPromptChange={onImagePromptChange}
            onRetry={() => onRetry(image.imageId)}
          />
        ))}
      </div>
    </section>
  );
}
