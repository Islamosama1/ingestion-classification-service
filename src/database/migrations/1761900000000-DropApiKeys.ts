import { MigrationInterface, QueryRunner } from 'typeorm';

// API access is now a single API_KEY from env: the keys table and the
// links to it go away.
export class DropApiKeys1761900000000 implements MigrationInterface {
  name = 'DropApiKeys1761900000000';

  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE "imports" DROP CONSTRAINT "FK_imports_api_key"`,
    );
    await qr.query(`ALTER TABLE "imports" DROP COLUMN "api_key_id"`);

    await qr.query(
      `ALTER TABLE "classifications" DROP CONSTRAINT "CHK_classifications_kind"`,
    );
    await qr.query(
      `ALTER TABLE "classifications" DROP CONSTRAINT "FK_classifications_api_key"`,
    );
    await qr.query(`ALTER TABLE "classifications" DROP COLUMN "api_key_id"`);
    await qr.query(`
      ALTER TABLE "classifications" ADD CONSTRAINT "CHK_classifications_kind" CHECK (
        (kind = 'auto' AND confidence IS NOT NULL AND corrects_id IS NULL)
        OR (kind = 'correction' AND corrects_id IS NOT NULL AND reason IS NOT NULL)
      )`);

    await qr.query(`DROP TABLE "api_keys"`);
  }

  public async down(qr: QueryRunner): Promise<void> {
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

    await qr.query(
      `ALTER TABLE "classifications" DROP CONSTRAINT "CHK_classifications_kind"`,
    );
    await qr.query(`ALTER TABLE "classifications" ADD "api_key_id" uuid`);
    await qr.query(`
      ALTER TABLE "classifications" ADD CONSTRAINT "FK_classifications_api_key"
        FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")`);
    await qr.query(`
      ALTER TABLE "classifications" ADD CONSTRAINT "CHK_classifications_kind" CHECK (
        (kind = 'auto' AND confidence IS NOT NULL AND corrects_id IS NULL)
        OR (kind = 'correction' AND corrects_id IS NOT NULL AND reason IS NOT NULL AND api_key_id IS NOT NULL)
      )`);

    // Only works on an empty imports table (dev only, no real data).
    await qr.query(`ALTER TABLE "imports" ADD "api_key_id" uuid NOT NULL`);
    await qr.query(`
      ALTER TABLE "imports" ADD CONSTRAINT "FK_imports_api_key"
        FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")`);
  }
}
