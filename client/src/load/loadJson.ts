interface ImportImage {
  // 兼容旧 JSON；服务端会忽略该值并按数组顺序生成 01、02、03……
  imageId?: string;
  url: string;
  prompt?: string;
}

export interface ImportBlock {
  blockId: string;
  listing: string;
  prompt?: string;
  images: ImportImage[];
}

// 浏览器先做快速结构检查，服务端仍会执行最终校验和安全下载。
export async function loadJsonFile(file: File): Promise<ImportBlock[]> {
  const value: unknown = JSON.parse(await file.text());
  const blocks = Array.isArray(value) ? value : (value as { blocks?: unknown })?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error("JSON 必须是非空 Block 数组");
  for (const [index, block] of blocks.entries()) {
    const item = block as Partial<ImportBlock>;
    if (!item.blockId || !item.listing) throw new Error(`第 ${index + 1} 个 Block 缺少 blockId 或 listing`);
    if (!Array.isArray(item.images) || item.images.length < 1 || item.images.length > 20) {
      throw new Error(`Block ${item.blockId} 必须有 1–20 张图片`);
    }
    for (const [imageIndex, image] of item.images.entries()) {
      if (!image?.url) throw new Error(`Block ${item.blockId} 的第 ${imageIndex + 1} 张图片缺少 url`);
    }
  }
  return blocks as ImportBlock[];
}
