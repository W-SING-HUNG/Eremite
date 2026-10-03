"use client";

import { useEffect } from "react";
import type { RendererProps } from "@/modules/viewer/contracts";

export function VideoRenderer({ sourceUrl, descriptor, onControlsChange, onFailure }: RendererProps) {
  useEffect(() => { onControlsChange(null); return () => onControlsChange(null); }, [onControlsChange]);
  return <div className="video-renderer"><video controls preload="metadata" playsInline src={sourceUrl} onError={() => onFailure("load_failed")}><track kind="captions" /></video><p>{descriptor.detectedMimeType === "video/webm" ? "WebM 预览取决于浏览器支持的 VP8/VP9 与 Opus/Vorbis 编解码器。" : "MP4/M4V 预览取决于浏览器支持的 H.264 与 AAC 编解码器。"}</p></div>;
}
