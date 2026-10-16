-- One row per classified post: the latest correction or gold row, otherwise the latest model row.
-- c.* is expanded at creation time: recreate this view when classifications gains a column.
CREATE VIEW effective_classifications AS
SELECT DISTINCT ON (c.post_id) c.*
FROM classifications c
ORDER BY c.post_id, (c.origin IN ('correction', 'gold')) DESC, c.created_at DESC, c.id DESC;
