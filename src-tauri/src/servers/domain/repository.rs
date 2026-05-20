use super::models::AppData;

pub trait Repository: Send + Sync {
    fn load(&self) -> Result<AppData, String>;
    fn save(&self, data: &AppData) -> Result<(), String>;
}
