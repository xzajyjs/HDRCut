use std::path::Path;

/// Atomically writes a `.hdrcut` JSON project file (write temp + rename) so crashes
/// or power loss can never leave a half-written project file.
pub fn save_project_file(file_path: &str, content: &str) -> Result<(), String> {
    let target = Path::new(file_path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create project directory: {e}"))?;
        }
    }
    let tmp_name = format!(
        ".{}.tmp.{}",
        target
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "project".to_string()),
        std::process::id()
    );
    let tmp_path = target.with_file_name(tmp_name);
    std::fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("Failed to write temporary project file: {e}"))?;

    // On Windows `rename` fails if destination already exists; remove first when overwriting.
    #[cfg(target_os = "windows")]
    if target.exists() {
        let _ = std::fs::remove_file(target);
    }

    std::fs::rename(&tmp_path, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to save project file: {e}")
    })?;
    Ok(())
}

/// Reads a `.hdrcut` JSON project file as UTF-8 text.
pub fn load_project_file(file_path: &str) -> Result<String, String> {
    let target = Path::new(file_path);
    if !target.is_file() {
        return Err(format!("Project file not found: {file_path}"));
    }
    std::fs::read_to_string(target).map_err(|e| format!("Failed to read project file: {e}"))
}

/// Checks existence of a batch of file paths (for missing media detection on project open).
pub fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .into_iter()
        .map(|p| !p.trim().is_empty() && Path::new(&p).is_file())
        .collect()
}

/// Checks whether a filename exists inside a given directory (used for smart folder auto-relink).
pub fn find_file_in_dir(dir_path: &str, file_name: &str) -> Option<String> {
    if dir_path.trim().is_empty() || file_name.trim().is_empty() {
        return None;
    }
    let candidate = Path::new(dir_path).join(file_name);
    if candidate.is_file() {
        Some(candidate.to_string_lossy().to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{check_files_exist, find_file_in_dir, load_project_file, save_project_file};

    #[test]
    fn test_project_save_load_and_exists() {
        let dir = std::env::temp_dir().join(format!("hdrcut_proj_test_{}", std::process::id()));
        let proj = dir.join("demo.hdrcut");
        let proj_str = proj.to_string_lossy().to_string();

        let sample = r#"{"format":"hdrcut-project","schema_version":1}"#;
        save_project_file(&proj_str, sample).expect("save should succeed");
        let loaded = load_project_file(&proj_str).expect("load should succeed");
        assert_eq!(loaded, sample);

        let flags = check_files_exist(vec![
            proj_str.clone(),
            dir.join("missing.mkv").to_string_lossy().to_string(),
        ]);
        assert_eq!(flags, vec![true, false]);

        let found = find_file_in_dir(&dir.to_string_lossy(), "demo.hdrcut");
        assert_eq!(found, Some(proj_str));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
