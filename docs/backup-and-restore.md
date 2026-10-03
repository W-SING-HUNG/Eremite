# Backup and restore

## Create a backup

Use **立即备份** in the application. It takes the single-writer lease, uses SQLite's backup API, reads retained blobs from that snapshot, copies and hashes every referenced blob, writes `manifest.json`, and only then atomically publishes a directory with a `complete` marker under `data/backups/`.

Before upgrading the application, create one backup and keep it outside the device as well.

## Restore

1. Stop every Eremite process. Restore is offline-only.
2. Call `restoreBackupToNewDataDirectory(backupDirectory, newDataDirectory)` from a maintenance script. It refuses an existing target, validates the complete marker, SQLite integrity/FKs, manifest paths, sizes and every SHA-256 before atomically publishing the new directory.
3. Keep the old `data/` unchanged. Rename it to a dated fallback, then rename the verified new directory to `data/`.
4. Start Eremite and check that no integrity warning appears.
5. Open current and historical file versions, a deep Folder path, an Action source and an Automation run snapshot.

Never restore over a running application and never copy a live SQLite database as a backup.
