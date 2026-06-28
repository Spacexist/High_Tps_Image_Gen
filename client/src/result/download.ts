import { absoluteApiUrl } from "../request/api";

export function downloadResult(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = absoluteApiUrl(url);
  anchor.download = filename;
  anchor.target = "_blank";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
