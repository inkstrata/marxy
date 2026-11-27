//! App-level shell commands.

use std::fs;

use crate::data_dir;

#[derive(serde::Serialize)]
pub struct ConfigPaths {
    pub config: String,
    pub data: String,
}

/// Platform config and data directories, or the one folder `MARXY_DATA_DIR` names. Creates them when missing.
#[tauri::command]
pub fn config_paths(app: tauri::AppHandle) -> Result<ConfigPaths, String> {
    let config_dir = data_dir::config_dir(&app).map_err(|e| e.to_string())?;
    let data_dir = data_dir::data_dir(&app).map_err(|e| e.to_string())?;
    fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let config = config_dir.join("config.toml");
    Ok(ConfigPaths {
        config: config.to_string_lossy().into_owned(),
        data: data_dir.to_string_lossy().into_owned(),
    })
}
