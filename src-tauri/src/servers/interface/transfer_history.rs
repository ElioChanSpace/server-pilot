use crate::servers::domain::TransferRecord;
use crate::servers::infrastructure::StateDatabase;
use tauri::State;

#[tauri::command(async)]
pub fn get_transfer_history(database: State<'_, StateDatabase>) -> Result<Vec<TransferRecord>, String> {
    database.transfer_history()
}

#[tauri::command(async)]
pub fn add_transfer_history(
    database: State<'_, StateDatabase>,
    record: TransferRecord,
) -> Result<TransferRecord, String> {
    database.add_transfer_history(record)
}

#[tauri::command(async)]
pub fn remove_transfer_history(database: State<'_, StateDatabase>, id: String) -> Result<(), String> {
    database.remove_transfer_history(&id)
}

#[tauri::command(async)]
pub fn remove_transfer_history_batch(
    database: State<'_, StateDatabase>,
    ids: Vec<String>,
) -> Result<(), String> {
    database.remove_transfer_history_batch(&ids)
}

#[tauri::command(async)]
pub fn clear_transfer_history(database: State<'_, StateDatabase>) -> Result<(), String> {
    database.clear_transfer_history()
}

#[tauri::command(async)]
pub fn replace_transfer_history(
    database: State<'_, StateDatabase>,
    records: Vec<TransferRecord>,
) -> Result<Vec<TransferRecord>, String> {
    database.replace_transfer_history(records)
}
