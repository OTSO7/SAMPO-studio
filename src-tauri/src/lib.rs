mod commands;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_story_file,
            commands::write_story_file,
            commands::write_export_file,
            commands::launch_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
