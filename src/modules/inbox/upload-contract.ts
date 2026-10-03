export const maximumFileUploadBytes = 512 * 1024 * 1024;

export type FileUploadFailureCode =
  | "unauthorized"
  | "invalid_origin"
  | "invalid_request"
  | "empty_file"
  | "file_too_large"
  | "upload_interrupted"
  | "write_failed"
  | "integrity_error"
  | "database_failed";

export type FileUploadResponse =
  | { ok: true; contentId: string }
  | { ok: false; code: FileUploadFailureCode; message: string };

export function fileUploadFailureMessage(code: FileUploadFailureCode) {
  switch (code) {
    case "empty_file": return "文件为空，无法上传。";
    case "file_too_large": return "文件过大，最大允许 512 MiB。";
    case "upload_interrupted": return "上传未完成，请检查连接后重试。";
    case "write_failed": return "无法写入本地存储，请检查磁盘空间和目录权限。";
    case "integrity_error": return "文件写入后的完整性校验失败，未保存任何资料。";
    case "database_failed": return "文件未能提交到收件箱，已清理未完成的数据。";
    case "unauthorized": return "登录已失效，请重新登录后上传。";
    case "invalid_origin": return "上传请求来源无效。";
    default: return "上传请求无效，请重新选择文件。";
  }
}

export function validateSelectedUpload(file: Pick<File, "size"> | null) {
  if (!file || file.size === 0) return { code: "empty_file" as const, message: "请选择一个非空文件。" };
  if (file.size > maximumFileUploadBytes) return { code: "file_too_large" as const, message: fileUploadFailureMessage("file_too_large") };
  return null;
}
