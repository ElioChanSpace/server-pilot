use std::sync::{Arc, Mutex};
use crate::servers::domain::AppData;
use crate::servers::domain::Repository;

pub struct AppState {
    pub data: Arc<Mutex<AppData>>,
    pub repository: Arc<dyn Repository>,
}

impl AppState {
    pub fn new(repository: Arc<dyn Repository>) -> Self {
        let data = repository.load().unwrap_or_default();
        Self {
            data: Arc::new(Mutex::new(data)),
            repository,
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let data = self.data.lock().map_err(|e| e.to_string())?;
        self.repository.save(&data)
    }
}
