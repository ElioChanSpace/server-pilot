use crate::servers::domain::{CommandRecord, TransferRecord};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const STATE_DB_FILE: &str = "state.db";
const MAX_COMMAND_HISTORY_RECORDS: usize = 1000;
const MAX_TRANSFER_HISTORY_RECORDS: usize = 200;

pub struct StateDatabase {
    connection: Mutex<Connection>,
}

impl StateDatabase {
    pub fn new(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        if !app_data_dir.exists() {
            std::fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
        }

        let connection = Connection::open(app_data_dir.join(STATE_DB_FILE))
            .map_err(|e| format!("打开状态数据库失败: {e}"))?;
        let database = Self {
            connection: Mutex::new(connection),
        };
        database.migrate()?;
        Ok(database)
    }

    pub fn command_history(&self) -> Result<Vec<CommandRecord>, String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT id, session_id, display_id, server_id, server_name, command, timestamp
                 FROM command_history
                 ORDER BY timestamp ASC, rowid ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = statement
            .query_map([], |row| {
                Ok(CommandRecord {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    display_id: row.get(2)?,
                    server_id: row.get(3)?,
                    server_name: row.get(4)?,
                    command: row.get(5)?,
                    timestamp: row.get::<_, i64>(6)? as u64,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn add_command_history(
        &self,
        session_id: String,
        display_id: String,
        server_id: String,
        server_name: String,
        command: String,
    ) -> Result<CommandRecord, String> {
        let command = command.trim().to_string();
        if command.is_empty() {
            return Err("命令不能为空".to_string());
        }

        let record = CommandRecord {
            id: Uuid::new_v4().to_string(),
            session_id,
            display_id,
            server_id,
            server_name,
            command,
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        };

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        insert_command_history_record(&transaction, &record)?;
        trim_command_history(&transaction)?;
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(record)
    }

    pub fn remove_command_history_by_session(&self, session_ids: &[String]) -> Result<(), String> {
        if session_ids.is_empty() {
            return Ok(());
        }

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        for session_id in session_ids {
            transaction
                .execute(
                    "DELETE FROM command_history WHERE session_id = ?1",
                    params![session_id],
                )
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn remove_command_history_by_server(&self, server_id: &str) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        connection
            .execute(
                "DELETE FROM command_history WHERE server_id = ?1",
                params![server_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_command_history(&self) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        connection
            .execute("DELETE FROM command_history", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn replace_command_history(
        &self,
        records: Vec<CommandRecord>,
    ) -> Result<Vec<CommandRecord>, String> {
        let mut records: Vec<CommandRecord> = records
            .into_iter()
            .filter(|record| !record.command.trim().is_empty())
            .collect();
        if records.len() > MAX_COMMAND_HISTORY_RECORDS {
            let remove_count = records.len() - MAX_COMMAND_HISTORY_RECORDS;
            records.drain(0..remove_count);
        }

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM command_history", [])
            .map_err(|e| e.to_string())?;
        for record in &records {
            insert_command_history_record(&transaction, record)?;
        }
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(records)
    }

    pub fn migrate_legacy_command_history(
        &self,
        records: &[CommandRecord],
    ) -> Result<bool, String> {
        if records.is_empty() || self.has_command_history()? {
            return Ok(false);
        }

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        for record in records
            .iter()
            .filter(|record| !record.command.trim().is_empty())
        {
            insert_command_history_record(&transaction, record)?;
        }
        trim_command_history(&transaction)?;
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(true)
    }

    pub fn transfer_history(&self) -> Result<Vec<TransferRecord>, String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT id, direction, file_name, local_path, remote_path, server_name,
                        total_bytes, transferred_bytes, average_speed, started_at,
                        completed_at, duration, status, error
                 FROM transfer_history
                 ORDER BY completed_at DESC, rowid DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = statement
            .query_map([], |row| {
                Ok(TransferRecord {
                    id: row.get(0)?,
                    direction: row.get(1)?,
                    file_name: row.get(2)?,
                    local_path: row.get(3)?,
                    remote_path: row.get(4)?,
                    server_name: row.get(5)?,
                    total_bytes: row.get::<_, i64>(6)? as u64,
                    transferred_bytes: row.get::<_, i64>(7)? as u64,
                    average_speed: row.get(8)?,
                    started_at: row.get::<_, i64>(9)? as u64,
                    completed_at: row.get::<_, i64>(10)? as u64,
                    duration: row.get::<_, i64>(11)? as u64,
                    status: row.get(12)?,
                    error: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn add_transfer_history(&self, record: TransferRecord) -> Result<TransferRecord, String> {
        if record.id.trim().is_empty() {
            return Err("传输记录 ID 不能为空".to_string());
        }

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        insert_transfer_history_record(&transaction, &record)?;
        trim_transfer_history(&transaction)?;
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(record)
    }

    pub fn remove_transfer_history(&self, id: &str) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        connection
            .execute("DELETE FROM transfer_history WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_transfer_history_batch(&self, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        for id in ids {
            transaction
                .execute("DELETE FROM transfer_history WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn clear_transfer_history(&self) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        connection
            .execute("DELETE FROM transfer_history", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn replace_transfer_history(
        &self,
        mut records: Vec<TransferRecord>,
    ) -> Result<Vec<TransferRecord>, String> {
        records.retain(|record| !record.id.trim().is_empty());
        records.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
        records.truncate(MAX_TRANSFER_HISTORY_RECORDS);

        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        let transaction = connection.transaction().map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM transfer_history", [])
            .map_err(|e| e.to_string())?;
        for record in &records {
            insert_transfer_history_record(&transaction, record)?;
        }
        transaction.commit().map_err(|e| e.to_string())?;

        Ok(records)
    }

    fn migrate(&self) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        connection
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS command_history (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    display_id TEXT NOT NULL,
                    server_id TEXT NOT NULL,
                    server_name TEXT NOT NULL,
                    command TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_command_history_server_timestamp
                    ON command_history(server_id, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_command_history_session
                    ON command_history(session_id);
                CREATE TABLE IF NOT EXISTS transfer_history (
                    id TEXT PRIMARY KEY NOT NULL,
                    direction TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    local_path TEXT NOT NULL,
                    remote_path TEXT NOT NULL,
                    server_name TEXT NOT NULL,
                    total_bytes INTEGER NOT NULL,
                    transferred_bytes INTEGER NOT NULL,
                    average_speed REAL NOT NULL,
                    started_at INTEGER NOT NULL,
                    completed_at INTEGER NOT NULL,
                    duration INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    error TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_transfer_history_completed_at
                    ON transfer_history(completed_at DESC);
                CREATE INDEX IF NOT EXISTS idx_transfer_history_server_name
                    ON transfer_history(server_name);
                ",
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn has_command_history(&self) -> Result<bool, String> {
        let connection = self.connection.lock().map_err(|e| e.to_string())?;
        let existing = connection
            .query_row("SELECT 1 FROM command_history LIMIT 1", [], |_| Ok(()))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(existing.is_some())
    }
}

fn insert_command_history_record(
    connection: &Connection,
    record: &CommandRecord,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR REPLACE INTO command_history
             (id, session_id, display_id, server_id, server_name, command, timestamp)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                record.id,
                record.session_id,
                record.display_id,
                record.server_id,
                record.server_name,
                record.command,
                record.timestamp as i64
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn trim_command_history(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM command_history
             WHERE rowid IN (
                 SELECT rowid FROM command_history
                 ORDER BY timestamp ASC, rowid ASC
                 LIMIT max((SELECT COUNT(*) FROM command_history) - ?1, 0)
             )",
            params![MAX_COMMAND_HISTORY_RECORDS as i64],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_transfer_history_record(
    connection: &Connection,
    record: &TransferRecord,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR REPLACE INTO transfer_history
             (id, direction, file_name, local_path, remote_path, server_name,
              total_bytes, transferred_bytes, average_speed, started_at,
              completed_at, duration, status, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                record.id,
                record.direction,
                record.file_name,
                record.local_path,
                record.remote_path,
                record.server_name,
                record.total_bytes as i64,
                record.transferred_bytes as i64,
                record.average_speed,
                record.started_at as i64,
                record.completed_at as i64,
                record.duration as i64,
                record.status,
                record.error,
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn trim_transfer_history(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM transfer_history
             WHERE rowid IN (
                 SELECT rowid FROM transfer_history
                 ORDER BY completed_at ASC, rowid ASC
                 LIMIT max((SELECT COUNT(*) FROM transfer_history) - ?1, 0)
             )",
            params![MAX_TRANSFER_HISTORY_RECORDS as i64],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
