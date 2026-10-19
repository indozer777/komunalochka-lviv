-- Synthetic fixtures for the LOCAL D1 database only. Never apply remotely.
DELETE FROM premium_redemptions WHERE user_id IN ('qa-person-approve','qa-person-decline');
DELETE FROM premium_access WHERE user_id IN ('qa-person-approve','qa-person-decline');
DELETE FROM premium_requests WHERE user_id IN ('qa-person-approve','qa-person-decline');
INSERT INTO premium_users (id,email,name,created_at,updated_at)
VALUES ('qa-person-approve','olena@example.test','Олена <тест>',1792432800000,1792432800000)
ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO premium_users (id,email,name,created_at,updated_at)
VALUES ('qa-person-decline','taras@example.test','Тарас',1792432800000,1792432800000)
ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO premium_requests (id,user_id,message,status,created_at,note)
VALUES ('qa-request-approve','qa-person-approve','Хочу зберігати історію витрат нашої родини.','pending',1792432800000,'');
INSERT INTO premium_requests (id,user_id,message,status,created_at,note)
VALUES ('qa-request-decline','qa-person-decline','Прошу відкрити додаткові можливості калькулятора.','pending',1792432800001,'');
