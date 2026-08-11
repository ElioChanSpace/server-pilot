use keyring::Entry;
use std::collections::HashMap;
use std::sync::Mutex;

const KEYCHAIN_SERVICE: &str = "com.server-pilot.dev";

// 内存缓存，避免重复读取钥匙串
lazy_static::lazy_static! {
    static ref PASSWORD_CACHE: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
    static ref PASSPHRASE_CACHE: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
}

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, account)
        .map_err(|err| format!("无法访问系统钥匙串: {err}"))
}

pub fn save_password(server_id: &str, password: &str) -> Result<(), String> {
    entry_for(&format!("password:{server_id}"))?
        .set_password(password)
        .map_err(|err| format!("保存密码到系统钥匙串失败: {err}"))?;

    // 更新缓存
    if let Ok(mut cache) = PASSWORD_CACHE.lock() {
        cache.insert(server_id.to_string(), Some(password.to_string()));
    }

    Ok(())
}

pub fn get_password(server_id: &str) -> Result<Option<String>, String> {
    // 先检查缓存
    if let Ok(cache) = PASSWORD_CACHE.lock() {
        if let Some(cached) = cache.get(server_id) {
            return Ok(cached.clone());
        }
    }

    // 缓存未命中，从钥匙串读取
    let password = match entry_for(&format!("password:{server_id}"))?.get_password() {
        Ok(password) => Some(password),
        Err(keyring::Error::NoEntry) => None,
        Err(err) => return Err(format!("读取系统钥匙串失败: {err}")),
    };

    // 存入缓存
    if let Ok(mut cache) = PASSWORD_CACHE.lock() {
        cache.insert(server_id.to_string(), password.clone());
    }

    Ok(password)
}

pub fn save_key_passphrase(server_id: &str, passphrase: &str) -> Result<(), String> {
    entry_for(&format!("key-passphrase:{server_id}"))?
        .set_password(passphrase)
        .map_err(|err| format!("保存密钥口令到系统钥匙串失败: {err}"))?;

    // 更新缓存
    if let Ok(mut cache) = PASSPHRASE_CACHE.lock() {
        cache.insert(server_id.to_string(), Some(passphrase.to_string()));
    }

    Ok(())
}

pub fn get_key_passphrase(server_id: &str) -> Result<Option<String>, String> {
    // 先检查缓存
    if let Ok(cache) = PASSPHRASE_CACHE.lock() {
        if let Some(cached) = cache.get(server_id) {
            return Ok(cached.clone());
        }
    }

    // 缓存未命中，从钥匙串读取
    let passphrase = match entry_for(&format!("key-passphrase:{server_id}"))?.get_password() {
        Ok(passphrase) => Some(passphrase),
        Err(keyring::Error::NoEntry) => None,
        Err(err) => return Err(format!("读取系统钥匙串密钥口令失败: {err}")),
    };

    // 存入缓存
    if let Ok(mut cache) = PASSPHRASE_CACHE.lock() {
        cache.insert(server_id.to_string(), passphrase.clone());
    }

    Ok(passphrase)
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
        Ok(()) => {
            // 清除缓存
            if let Ok(mut cache) = PASSWORD_CACHE.lock() {
                cache.remove(server_id);
            }
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除系统钥匙串凭据失败: {err}")),
    }
}

pub fn delete_key_passphrase(server_id: &str) -> Result<(), String> {
    match entry_for(&format!("key-passphrase:{server_id}"))?.delete_credential() {
        Ok(()) => {
            // 清除缓存
            if let Ok(mut cache) = PASSPHRASE_CACHE.lock() {
                cache.remove(server_id);
            }
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除系统钥匙串密钥口令失败: {err}")),
    }
}

/// 清除所有缓存（用于测试或安全场景）
#[allow(dead_code)]
pub fn clear_cache() {
    if let Ok(mut cache) = PASSWORD_CACHE.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = PASSPHRASE_CACHE.lock() {
        cache.clear();
    }
}
