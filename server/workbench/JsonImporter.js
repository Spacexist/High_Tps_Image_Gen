// 导入器只接受一个稳定的数据结构，避免 UI、缓存和 Core 各自猜测字段含义。
import { ValidationError } from "../shared/errors.js";

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

function requireId(value, field) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new ValidationError(`${field} 只能包含字母、数字、下划线和短横线`);
  }
  return value;
}

export function parseWorkbenchJson(input) {
  const blocks = Array.isArray(input) ? input : input?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new ValidationError("导入 JSON 必须是非空 Block 数组");
  }

  const blockIds = new Set();
  return blocks.map((rawBlock, blockIndex) => {
    const blockId = requireId(rawBlock?.blockId, `blocks[${blockIndex}].blockId`);
    if (blockIds.has(blockId)) throw new ValidationError(`blockId "${blockId}" 重复`);
    blockIds.add(blockId);

    if (typeof rawBlock.listing !== "string" || !rawBlock.listing.trim()) {
      throw new ValidationError(`Block "${blockId}" 缺少 listing`);
    }
    if (!Array.isArray(rawBlock.images) || rawBlock.images.length < 1 || rawBlock.images.length > 20) {
      throw new ValidationError(`Block "${blockId}" 必须包含 1 到 20 张图片`);
    }

    const imageIds = new Set();
    const images = rawBlock.images.map((rawImage, imageIndex) => {
      const imageId = requireId(rawImage?.imageId, `blocks[${blockIndex}].images[${imageIndex}].imageId`);
      if (imageIds.has(imageId)) throw new ValidationError(`Block "${blockId}" 中 imageId "${imageId}" 重复`);
      imageIds.add(imageId);
      try {
        const url = new URL(rawImage.url);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new ValidationError(`图片 "${blockId}/${imageId}" 的 url 无效`);
      }
      return {
        imageId,
        url: rawImage.url,
        promptOverride: typeof rawImage.prompt === "string" ? rawImage.prompt : "",
      };
    });

    return {
      blockId,
      listing: rawBlock.listing.trim(),
      prompt: typeof rawBlock.prompt === "string" ? rawBlock.prompt : "",
      images,
    };
  });
}
