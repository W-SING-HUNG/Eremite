/**
 * Public Projects read contract for composing Folder visibility into another
 * module's SQLite query. Keeping this contract as SQL preserves database-side
 * filtering and keyset pagination without exposing Folder table ownership.
 */
export function effectiveFolderVisibilitySql(folderIdReference: string) {
  assertColumnReference(folderIdReference);
  const cteName = "projects_effectively_trashed_folders";
  return Object.freeze({
    recursiveCte: `${cteName}(id) AS (
      SELECT id FROM folders WHERE trashed_at IS NOT NULL
      UNION
      SELECT folder.id FROM folders folder JOIN ${cteName} trashed ON folder.parent_id = trashed.id
    )`,
    visiblePredicate: `(${folderIdReference} IS NULL OR ${folderIdReference} NOT IN (SELECT id FROM ${cteName}))`,
  });
}

/** Point-read variant: only walks the selected Folder's ancestor chain. */
export function folderAncestorVisibilitySql(sourceCte: string, folderIdColumn: string) {
  assertIdentifier(sourceCte);
  assertIdentifier(folderIdColumn);
  const cteName = "projects_folder_ancestors";
  return Object.freeze({
    recursiveCte: `${cteName}(id, parent_id, trashed_at) AS (
      SELECT folder.id, folder.parent_id, folder.trashed_at
        FROM folders folder
       WHERE folder.id = (SELECT ${folderIdColumn} FROM ${sourceCte})
      UNION
      SELECT folder.id, folder.parent_id, folder.trashed_at
        FROM folders folder JOIN ${cteName} ancestor ON folder.id = ancestor.parent_id
    )`,
    visiblePredicate: `NOT EXISTS (SELECT 1 FROM ${cteName} WHERE trashed_at IS NOT NULL)`,
  });
}

function assertColumnReference(value: string) {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/iu.test(value)) throw new Error("invalid_folder_visibility_column_reference");
}

function assertIdentifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/iu.test(value)) throw new Error("invalid_folder_visibility_identifier");
}
