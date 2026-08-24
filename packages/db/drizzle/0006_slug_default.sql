ALTER TABLE "conversations" ALTER COLUMN "slug" SET DEFAULT substr(md5(random()::text), 1, 7);
