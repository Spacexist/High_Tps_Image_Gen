// Key 选择器只做模型匹配；租约状态由 KeyPool 统一维护。
export class KeySelector {
  select(availableKeys, { model } = {}) {
    for (const key of availableKeys) {
      if (!model || key.models.includes(model) || key.models.includes("*")) {
        return key;
      }
    }
    return null;
  }
}
