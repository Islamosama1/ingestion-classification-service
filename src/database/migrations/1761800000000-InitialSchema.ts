import { MigrationInterface, QueryRunner } from 'typeorm';

// Values are written out here (not imported) so this migration never changes.
export class InitialSchema1761800000000 implements MigrationInterface {
  name = 'InitialSchema1761800000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE "api_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(100) NOT NULL,
        "key_hash" character(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_api_keys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_api_keys_key_hash" UNIQUE ("key_hash")
      )`);

    await qr.query(`
      CREATE TABLE "imports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "api_key_id" uuid NOT NULL,
        "status" text NOT NULL DEFAULT 'processing',
        "total" integer NOT NULL,
        "created_count" integer NOT NULL DEFAULT 0,
        "duplicate_count" integer NOT NULL DEFAULT 0,
        "conflict_count" integer NOT NULL DEFAULT 0,
        "invalid_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_imports" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_imports_status" CHECK (status IN ('processing', 'completed')),
        CONSTRAINT "CHK_imports_counts" CHECK (total >= 0 AND created_count >= 0 AND duplicate_count >= 0 AND conflict_count >= 0 AND invalid_count >= 0),
        CONSTRAINT "FK_imports_api_key" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
      )`);

    await qr.query(`
      CREATE TABLE "records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" character varying(100) NOT NULL,
        "external_id" character varying(255) NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" character varying(5000) NOT NULL,
        "effective_date" TIMESTAMP WITH TIME ZONE NOT NULL,
        "content_hash" character(64) NOT NULL,
        "import_id" uuid NOT NULL,
        "class_status" text NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "locked_at" TIMESTAMP WITH TIME ZONE,
        "current_classification_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_records_source_external_id" UNIQUE ("source", "external_id"),
        CONSTRAINT "CHK_records_class_status" CHECK (class_status IN ('pending', 'processing', 'classified', 'needs_review', 'failed')),
        CONSTRAINT "CHK_records_attempts" CHECK (attempts >= 0),
        CONSTRAINT "FK_records_import" FOREIGN KEY ("import_id") REFERENCES "imports"("id")
      )`);
    await qr.query(
      `CREATE INDEX "IDX_records_claim" ON "records" ("class_status", "next_attempt_at")`,
    );
    await qr.query(
      `CREATE INDEX "IDX_records_import" ON "records" ("import_id")`,
    );
    await qr.query(
      `CREATE INDEX "IDX_records_effective_date" ON "records" ("effective_date")`,
    );

    await qr.query(`
      CREATE TABLE "classifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "record_id" uuid NOT NULL,
        "category" text NOT NULL,
        "confidence" numeric(4,3),
        "needs_review" boolean NOT NULL DEFAULT false,
        "kind" text NOT NULL,
        "corrects_id" uuid,
        "reason" text,
        "api_key_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_classifications" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_classifications_category" CHECK (category IN ('sports', 'culture', 'education', 'business', 'health', 'other')),
        CONSTRAINT "CHK_classifications_confidence" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        CONSTRAINT "CHK_classifications_kind" CHECK (
          (kind = 'auto' AND confidence IS NOT NULL AND corrects_id IS NULL)
          OR (kind = 'correction' AND corrects_id IS NOT NULL AND reason IS NOT NULL AND api_key_id IS NOT NULL)
        ),
        CONSTRAINT "FK_classifications_record" FOREIGN KEY ("record_id") REFERENCES "records"("id"),
        CONSTRAINT "FK_classifications_corrects" FOREIGN KEY ("corrects_id") REFERENCES "classifications"("id"),
        CONSTRAINT "FK_classifications_api_key" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
      )`);
    await qr.query(
      `CREATE INDEX "IDX_classifications_record" ON "classifications" ("record_id")`,
    );
    await qr.query(`
      ALTER TABLE "records" ADD CONSTRAINT "FK_records_current_classification"
        FOREIGN KEY ("current_classification_id") REFERENCES "classifications"("id")`);

    // Classifications are history: never changed or removed.
    await qr.query(`
      CREATE OR REPLACE FUNCTION classifications_append_only() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'classifications are append-only';
      END
      $$`);
    await qr.query(`
      CREATE TRIGGER "TRG_classifications_append_only"
        BEFORE UPDATE OR DELETE ON "classifications"
        FOR EACH ROW EXECUTE FUNCTION classifications_append_only()`);

    await qr.query(`
      CREATE TABLE "import_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "import_id" uuid NOT NULL,
        "index" integer NOT NULL,
        "external_id" text,
        "source" text,
        "outcome" text NOT NULL,
        "errors" jsonb,
        "record_id" uuid,
        CONSTRAINT "PK_import_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_import_items_import_index" UNIQUE ("import_id", "index"),
        CONSTRAINT "CHK_import_items_outcome" CHECK (outcome IN ('created', 'duplicate', 'conflict', 'invalid')),
        CONSTRAINT "CHK_import_items_record" CHECK ((outcome = 'invalid') = (record_id IS NULL)),
        CONSTRAINT "FK_import_items_import" FOREIGN KEY ("import_id") REFERENCES "imports"("id"),
        CONSTRAINT "FK_import_items_record" FOREIGN KEY ("record_id") REFERENCES "records"("id")
      )`);
    await qr.query(
      `CREATE INDEX "IDX_import_items_import_outcome" ON "import_items" ("import_id", "outcome")`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE "import_items"`);
    await qr.query(
      `ALTER TABLE "records" DROP CONSTRAINT "FK_records_current_classification"`,
    );
    await qr.query(`DROP TABLE "classifications"`);
    await qr.query(`DROP FUNCTION classifications_append_only()`);
    await qr.query(`DROP TABLE "records"`);
    await qr.query(`DROP TABLE "imports"`);
    await qr.query(`DROP TABLE "api_keys"`);
  }
}
