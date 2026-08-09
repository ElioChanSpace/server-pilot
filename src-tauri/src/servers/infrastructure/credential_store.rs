use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.server-pilot.dev";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|err| format!("无法访问系统钥匙串: {err}"))
}

pub fn save_password(server_id: &str, password: &str) -> Result<(), String> {
    entry_for(&format!("password:{server_id}"))?
        .set_password(password)
        .map_err(|err| format!("保存密码到系统钥匙串失败: {err}"))
}

pub fn get_password(server_id: &str) -> Result<Option<String>, String> {
    match entry_for(&format!("password:{server_id}"))?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取系统钥匙串失败: {err}")),
    }
}

pub fn save_key_passphrase(server_id: &str, passphrase: &str) -> Result<(), String> {
    entry_for(&format!("key-passphrase:{server_id}"))?
        .set_password(passphrase)
        .map_err(|err| format!("保存密钥口令到系统钥匙串失败: {err}"))
}

pub fn get_key_passphrase(server_id: &str) -> Result<Option<String>, String> {
    match entry_for(&format!("key-passphrase:{server_id}"))?.get_password() {
        Ok(passphrase) => Ok(Some(passphrase)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取系统钥匙串密钥口令失败: {err}")),
    }
}

pub fn migrate_legacy_passwords(
    data: &mut crate::servers::domain::AppData,
) -> Result<bool, String> {
    let mut changed = false;
    for server in data.servers.iter_mut() {
        if let Some(password) = server.password.take() {
            if !password.is_empty() {
                save_password(&server.id, &password)?;
                server.has_password = true;
            }
            changed = true;
        }
        if let Some(passphrase) = server.key_passphrase.take() {
            if !passphrase.is_empty() {
                save_key_passphrase(&server.id, &passphrase)?;
                server.has_key_passphrase = true;
            }
            changed = true;
        }
    }
    Ok(changed)
}

#[allow(dead_code)]
pub fn delete_password(server_id: &str) -> Result<(), String> {
    match entry_for(&format!("password:{server_id}"))?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除系统钥匙串凭据失败: {err}")),
    }
}
