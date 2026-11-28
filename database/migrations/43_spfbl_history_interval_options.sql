-- SPFBL: a coleta passa a oferecer 5, 10, 15 e 30 minutos, 1, 2 e 3 horas. Valores antigos fora dessa lista são ajustados (menos de 1 hora: 15 minutos; acima de 3 horas: 3 horas; o padrão antigo de 24 horas vira 1 hora).
ALTER TABLE spfbl_settings DROP CONSTRAINT IF EXISTS spfbl_settings_history_interval_minutes_check;
ALTER TABLE spfbl_settings DROP CONSTRAINT IF EXISTS spfbl_settings_history_interval_options_check;
UPDATE spfbl_settings SET history_interval_minutes = CASE WHEN history_interval_minutes IN (5, 10, 15, 30, 60, 120, 180) THEN history_interval_minutes WHEN history_interval_minutes = 1440 THEN 60 WHEN history_interval_minutes < 60 THEN 15 WHEN history_interval_minutes < 120 THEN 60 WHEN history_interval_minutes < 180 THEN 120 ELSE 180 END;
ALTER TABLE spfbl_settings ALTER COLUMN history_interval_minutes SET DEFAULT 60;
ALTER TABLE spfbl_settings ADD CONSTRAINT spfbl_settings_history_interval_options_check CHECK (history_interval_minutes IN (5, 10, 15, 30, 60, 120, 180));
