mod commands;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // The updater is desktop-only. The frontend checks for releases after startup.
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_story_file,
            commands::write_story_file,
            commands::story_file_modified,
            commands::write_export_file,
            commands::launch_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
