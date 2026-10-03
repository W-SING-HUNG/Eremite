PRAGMA foreign_keys = ON;

CREATE INDEX content_items_created_keyset_idx ON content_items(trashed_at, created_at DESC, id DESC);
CREATE INDEX actions_v11_sort_keyset_idx ON actions(trashed_at, priority, due_date, created_at DESC, id DESC);
