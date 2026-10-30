//! The database's tables: NestJS's migrations (../backend/src/migrations), which Rust runs now that NestJS is
//! gone. TypeORM ran them each time NestJS started (migrationsRun) and wrote each one down in the table
//! "migrations". Rust reads and writes the same table, so a database NestJS set up carries on as it is, and a new
//! one gets every migration, in order.
//!
//! Each migration's SQL is in migrations/ (from this folder): the statements of NestJS's migration, exactly as
//! TypeORM runs them. A new change to the tables is a new file there, added to the end of MIGRATIONS.

use sqlx::PgPool;

struct Migration {
    timestamp: i64,
    name: &'static str, // TypeORM's name for it: the class name, e.g. "InitialSchema1792122576483"
    sql: &'static str,
}

/// One migration, from its file migrations/<timestamp>-<Name>.sql. `include_str!` puts the file's text into the
/// program itself when it's compiled, so the program doesn't need the folder next to it.
macro_rules! migration {
    ($timestamp:literal, $name:literal) => {
        Migration {
            timestamp: $timestamp,
            name: concat!($name, stringify!($timestamp)),
            sql: include_str!(concat!("../migrations/", stringify!($timestamp), "-", $name, ".sql")),
        }
    };
}

/// Every migration, oldest first (the list in ../backend/src/migrations/index.ts)
const MIGRATIONS: &[Migration] = &[
    migration!(1792122576483, "InitialSchema"),
    migration!(1792125187609, "AddBoards"),
    migration!(1792139766723, "AddTaskDetails"),
    migration!(1792323520653, "AddLabels"),
    migration!(1792329867365, "AddUserTimeZone"),
    migration!(1792336190154, "AddAttachments"),
    migration!(1792464610909, "AddChatResponseTime"),
    migration!(1792938232098, "AddProfileSettings"),
    migration!(1793065936801, "AddClaudeRunner"),
    migration!(1793067333467, "AddAgentRuns"),
    migration!(1793073308265, "AddAiBuiltAt"),
    migration!(1793083340862, "AddAiActivity"),
    migration!(1793100000000, "AddAiMerge"),
];

/// Any number will do, as long as nothing else locks it: two copies of the backend starting at once take turns
const MIGRATIONS_LOCK: i64 = 7_240_117;

/// Runs the migrations this database hasn't had yet, all in one transaction (TypeORM's way): all of them, or none
/// if one fails. Gives back how many ran.
pub async fn run(db: &PgPool) -> Result<usize, sqlx::Error> {
    let mut transaction = db.begin().await?;
    // One copy at a time: a second one starting at the same moment waits here, then finds nothing left to do
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(MIGRATIONS_LOCK)
        .execute(&mut *transaction)
        .await?;
    // TypeORM's own table, as TypeORM makes it
    sqlx::raw_sql(
        r#"CREATE TABLE IF NOT EXISTS "migrations" ("id" SERIAL NOT NULL, "timestamp" bigint NOT NULL,
           "name" character varying NOT NULL, CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id"))"#,
    )
    .execute(&mut *transaction)
    .await?;
    let done: Vec<String> = sqlx::query_scalar(r#"SELECT "name" FROM "migrations""#)
        .fetch_all(&mut *transaction)
        .await?;

    let mut ran = 0;
    for migration in MIGRATIONS
        .iter()
        .filter(|migration| !done.iter().any(|name| name == migration.name))
    {
        // raw_sql: the whole file, several statements, as it is
        sqlx::raw_sql(migration.sql).execute(&mut *transaction).await?;
        sqlx::query(r#"INSERT INTO "migrations" ("timestamp", "name") VALUES ($1, $2)"#)
            .bind(migration.timestamp)
            .bind(migration.name)
            .execute(&mut *transaction)
            .await?;
        tracing::info!("Migration {} done", migration.name);
        ran += 1;
    }
    transaction.commit().await?;
    Ok(ran)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn named_as_typeorm_names_them() {
        assert_eq!(MIGRATIONS[0].name, "InitialSchema1792122576483");
        assert_eq!(MIGRATIONS[0].timestamp, 1_792_122_576_483);
        assert!(MIGRATIONS[0].sql.contains(r#"CREATE TABLE "users""#));
        // Oldest first, each once
        assert!(MIGRATIONS.windows(2).all(|pair| pair[0].timestamp < pair[1].timestamp));
    }
}
