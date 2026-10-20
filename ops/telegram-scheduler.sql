-- Run as project owner after enabling pg_cron, pg_net and pgcrypto.
-- Configure the matching secret in Sites and Vault separately; do not put it here.
select cron.schedule('komunalochka-telegram-reminders','*/5 * * * *', $job$
with reminder_auth as (select floor(extract(epoch from clock_timestamp()))::bigint::text as stamp), signed as (select stamp,encode(extensions.hmac('telegram-tick:'||stamp,(select decrypted_secret from vault.decrypted_secrets where name='komunalochka_telegram_cron_secret'),'sha256'),'hex') as signature from reminder_auth) select net.http_post(url := 'https://komunalochka.com/api/telegram/tick', headers := jsonb_build_object('Content-Type','application/json','X-Komunalochka-Timestamp',stamp,'X-Komunalochka-Cron',signature), body := '{}'::jsonb, timeout_milliseconds := 60000) from signed;
$job$);
