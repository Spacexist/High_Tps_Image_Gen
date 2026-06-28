import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkbenchJson } from "../../server/workbench/JsonImporter.js";

test("工作台导入器接受一个 Listing 加 1–20 张图片", () => {
  const blocks = parseWorkbenchJson([{
    blockId: "listing-001",
    listing: "A useful product",
    prompt: "clean background",
    images: [{ imageId: "front", url: "https://example.test/front.png" }],
  }]);
  assert.equal(blocks[0].images.length, 1);
  assert.equal(blocks[0].images[0].promptOverride, "");
});

test("工作台拒绝超过 20 张图片的 Block", () => {
  assert.throws(() => parseWorkbenchJson([{
    blockId: "too-many",
    listing: "Too many",
    images: Array.from({ length: 21 }, (_, index) => ({
      imageId: `img-${index}`,
      url: `https://example.test/${index}.png`,
    })),
  }]), /1 到 20 张图片/);
});
