export const archiveEntryLimit = 5_000;
export const quickArchiveEntryLimit = 200;

export { inspectZipDirectory, isUnsafeArchivePath, parseZipCentralDirectory } from "@/platform/files/zip-inspection";
export type { ZipCentralDirectoryEntry, ZipDirectoryInfo } from "@/platform/files/zip-inspection";
