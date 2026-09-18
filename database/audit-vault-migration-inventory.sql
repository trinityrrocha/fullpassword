-- Read-only inventory. Does not select secrets, envelopes, names or email addresses.
SELECT COALESCE(crypto_identity->>'version','legacy_or_absent') AS identity_version,
       COUNT(*) AS accounts, COUNT(*) FILTER (WHERE is_active) AS active_accounts
FROM users GROUP BY 1 ORDER BY 1;
SELECT c.id AS vault_id,c.created_by AS owner_id,c.crypto_epoch,c.crypto_revision,c.rotation_required,
       (SELECT COUNT(*) FROM vault_items v WHERE v.client_id=c.id) AS legacy_snapshots,
       (SELECT COUNT(*) FROM vault_records r WHERE r.client_id=c.id AND NOT r.deleted) AS active_records,
       (SELECT COUNT(*) FROM vault_migration_stages s WHERE s.client_id=c.id AND s.state='staging') AS pending_stages,
       (SELECT COUNT(DISTINCT u.id) FROM users u WHERE u.is_active AND u.crypto_identity IS NULL AND
          (u.id=c.created_by OR EXISTS(SELECT 1 FROM user_groups ug JOIN groups g ON g.id=ug.group_id
            JOIN client_group_access a ON a.group_id=g.id WHERE ug.user_id=u.id AND a.client_id=c.id AND g.can_view AND a.can_view))) AS identities_pending
FROM clients c ORDER BY c.id;
