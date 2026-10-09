use crate::servers::domain::CommandRecord;
use crate::servers::infrastructure::StateDatabase;
use tauri::State;

#[tauri::command(async)]
pub fn get_command_history(
    database: State<'_, StateDatabase>,
) -> Result<Vec<CommandRecord>, String> {
    database.command_history()
}

#[tauri::command(async)]
pub fn add_command_history(
    database: State<'_, StateDatabase>,
    session_id: String,
    display_id: String,
    server_id: String,
    server_name: String,
    command: String,
) -> Result<CommandRecord, String> {
    database.add_command_history(session_id, display_id, server_id, server_name, command)
}

#[tauri::command(async)]
pub fn remove_command_history_by_session(
    database: State<'_, StateDatabase>,
    session_ids: Vec<String>,
) -> Result<(), String> {
    database.remove_command_history_by_session(&session_ids)
}

#[tauri::command(async)]
pub fn remove_command_history_by_server(
    database: State<'_, StateDatabase>,
    server_id: String,
) -> Result<(), String> {
    database.remove_command_history_by_server(&server_id)
}

#[tauri::command(async)]
pub fn clear_command_history(database: State<'_, StateDatabase>) -> Result<(), String> {
    database.clear_command_history()
}

#[tauri::command(async)]
pub fn replace_command_history(
    database: State<'_, StateDatabase>,
    records: Vec<CommandRecord>,
) -> Result<Vec<CommandRecord>, String> {
    database.replace_command_history(records)
}
