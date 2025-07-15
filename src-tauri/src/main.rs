// src-tauri/src/main.rs

// Prevents additional console window on Windows in release,
// but leaves it in debug in case of problems.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Serialize, Deserialize};
use serde_json::json;
use std::collections::{HashSet, HashMap};
use std::env;
use std::path::PathBuf;
use tokio::fs;
use reqwest::Client;
use chrono::Utc;
use std::sync::Mutex;
use tauri::State;
use log::{info, debug, error, warn}; // Import debug, error, and warn

// --- Estructuras de Datos de la Aplicación ---

/// Tipo de transacción: Ingreso o Gasto.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
enum TransactionType {
    Ingreso,
    Gasto,
}

impl ToString for TransactionType {
    fn to_string(&self) -> String {
        match self {
            TransactionType::Ingreso => "Ingreso".to_string(),
            TransactionType::Gasto => "Gasto".to_string(),
        }
    }
}

/// Representa una transacción contable individual.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Transaction {
    id: String,
    #[serde(rename = "type")]
    transaction_type: TransactionType,
    amount: f64,
    description: String,
    store_name: String,
    timestamp: u64,
}

/// Estado compartido de la aplicación Rust.
/// Usamos Mutex para permitir el acceso mutable y seguro desde múltiples threads/comandos.
struct AppState {
    transactions: Mutex<Vec<Transaction>>,
}

// --- Lógica de Persistencia Local ---

const DATA_FILE_NAME: &str = "transactions.json";

/// Obtiene la ruta persistente para guardar el archivo usando dirs.
/// Esta función ha sido restaurada para usar dirs::data_local_dir()
/// para asegurar la persistencia de los datos entre ejecuciones.
fn get_data_file_path() -> PathBuf {
    let mut path = dirs::data_local_dir()
        .expect("No se pudo obtener el directorio de datos local.");
    path.push("com.tuempresa.contabilidad"); // Subdirectorio específico para tu app
    path.push(DATA_FILE_NAME);
    debug!("Ruta del archivo de datos: {}", path.display());
    path
}

/// Carga las transacciones desde el archivo JSON local.
async fn load_transactions_from_file() -> Result<Vec<Transaction>, String> {
    let path = get_data_file_path();
    if path.exists() {
        match fs::read_to_string(&path).await {
            Ok(data) => {
                // Clonar 'data' para usarla en el log después de que 'serde_json::from_str' la tome por referencia.
                // Esto resuelve el error "borrow of moved value: `data`".
                let data_for_log = data.clone(); 
                match serde_json::from_str(&data) {
                    Ok(transactions) => {
                        info!("Transacciones cargadas de: {}", path.display());
                        debug!("Contenido cargado (para depuración): {}", data_for_log); // Usamos la copia
                        Ok(transactions)
                    },
                    Err(e) => {
                        error!("Error al parsear transacciones de {}: {}", path.display(), e);
                        Err(format!("Error al parsear datos de transacciones: {}", e))
                    }
                }
            },
            Err(e) => {
                error!("Error al leer archivo de transacciones {}: {}", path.display(), e);
                Err(format!("Error al leer archivo de datos: {}", e))
            }
        }
    } else {
        warn!("Archivo de datos no encontrado en {}. Iniciando con transacciones vacías.", path.display());
        Ok(Vec::new())
    }
}

/// Guarda las transacciones al archivo JSON local.
async fn save_transactions_to_file(transactions: &[Transaction]) -> Result<(), String> {
    let path = get_data_file_path();
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            return Err(format!("Falló la creación del directorio padre ({}): {}", parent.display(), e));
        }
    }

    match serde_json::to_string_pretty(transactions) {
        Ok(data) => {
            match fs::write(&path, data).await {
                Ok(_) => {
                    info!("Transacciones guardadas en: {}", path.display());
                    debug!("Contenido guardado: {}", serde_json::to_string_pretty(transactions).unwrap_or_else(|_| "Error al serializar para depuración".to_string()));
                    Ok(())
                },
                Err(e) => {
                    error!("Error al guardar transacciones en {}: {}", path.display(), e);
                    Err(format!("Error al guardar transacciones: {}", e))
                }
            }
        },
        Err(e) => Err(format!("Falló la serialización de transacciones para guardar: {}", e)),
    }
}

// --- Comandos Tauri (accesibles desde el frontend) ---

/// Comando para obtener todas las transacciones.
#[tauri::command]
async fn get_all_transactions(state: State<'_, AppState>) -> Result<Vec<Transaction>, String> {
    debug!("Received get_all_transactions command.");
    let transactions = state.transactions.lock().unwrap().clone();
    debug!("Returning {} transactions.", transactions.len());
    Ok(transactions)
}

/// Comando para añadir una nueva transacción.
#[tauri::command]
async fn add_transaction_command(
    state: State<'_, AppState>,
    transaction_type_str: String,
    amount: f64,
    description: String,
    store_name: String,
) -> Result<Transaction, String> {
    debug!("Received add_transaction_command: type={}, amount={}, desc='{}', store='{}'",
           transaction_type_str, amount, description, store_name);

    let transaction_type = match transaction_type_str.as_str() {
        "Ingreso" => TransactionType::Ingreso,
        "Gasto" => TransactionType::Gasto,
        _ => {
            error!("Invalid transaction type received: {}", transaction_type_str);
            return Err("Tipo de transacción inválido".to_string())
        },
    };

    if amount <= 0.0 {
        error!("Invalid amount received: {}", amount);
        return Err("El monto debe ser positivo.".to_string());
    }
    if description.trim().is_empty() || store_name.trim().is_empty() {
        error!("Empty description or store name.");
        return Err("La descripción y el nombre de la tienda no pueden estar vacíos.".to_string());
    }

    let new_transaction = Transaction {
        id: uuid::Uuid::new_v4().to_string(),
        transaction_type,
        amount,
        description: description.trim().to_owned(),
        store_name: store_name.trim().to_owned(),
        timestamp: Utc::now().timestamp() as u64,
    };

    let transactions_to_save: Vec<Transaction>;

    {
        let mut transactions = state.transactions.lock().unwrap();
        transactions.push(new_transaction.clone());
        transactions_to_save = transactions.clone();
    }

    match save_transactions_to_file(&transactions_to_save).await {
        Ok(_) => {
            debug!("Transaction added and saved successfully: {:?}", new_transaction);
            Ok(new_transaction)
        },
        Err(e) => {
            error!("Failed to save transactions after adding: {}", e);
            Err(e)
        }
    }
}

/// Comando para actualizar una transacción existente.
#[tauri::command]
async fn update_transaction_command(
    state: State<'_, AppState>,
    id: String,
    transaction_type_str: String,
    amount: f64,
    description: String,
    store_name: String,
) -> Result<Transaction, String> {
    debug!("Received update_transaction_command for ID: {}", id);
    let transaction_type = match transaction_type_str.as_str() {
        "Ingreso" => TransactionType::Ingreso,
        "Gasto" => TransactionType::Gasto,
        _ => {
            error!("Invalid transaction type received for update: {}", transaction_type_str);
            return Err("Tipo de transacción inválido".to_string())
        },
    };

    if amount <= 0.0 {
        error!("Invalid amount received for update: {}", amount);
        return Err("El monto debe ser positivo.".to_string());
    }
    if description.trim().is_empty() || store_name.trim().is_empty() {
        error!("Empty description or store name for update.");
        return Err("La descripción y el nombre de la tienda no pueden estar vacíos.".to_string());
    }

    let updated_transaction_result: Result<Transaction, String>;
    let transactions_to_save: Vec<Transaction>;

    { // Inicia un nuevo scope para controlar la vida útil de `transactions_guard`
        let mut transactions_guard = state.transactions.lock().unwrap();

        if let Some(pos) = transactions_guard.iter().position(|t| t.id == id) {
            let transaction = &mut transactions_guard[pos];
            transaction.transaction_type = transaction_type;
            transaction.amount = amount;
            transaction.description = description.trim().to_owned();
            transaction.store_name = store_name.trim().to_owned();
            
            updated_transaction_result = Ok(transaction.clone()); // Inicializar con Ok aquí
            transactions_to_save = transactions_guard.clone(); // Clonar para guardar
            debug!("Transaction found and updated in memory: ID {}", id);
        } else {
            error!("Transaction with ID {} not found for update.", id);
            updated_transaction_result = Err(format!("Transacción con ID {} no encontrada.", id));
            transactions_to_save = transactions_guard.clone(); // Clonar el estado actual si no se encuentra
        }
    } // `transactions_guard` se libera automáticamente aquí

    // Si la transacción no se encontró, devuelve el error inmediatamente
    if updated_transaction_result.is_err() {
        return updated_transaction_result;
    }

    // Si se encontró y actualizó, guarda los cambios y devuelve el resultado
    match save_transactions_to_file(&transactions_to_save).await {
        Ok(_) => {
            debug!("Transactions saved after update.");
            updated_transaction_result
        },
        Err(e) => {
            error!("Failed to save transactions after update: {}", e);
            Err(e)
        }
    }
}

/// Comando para eliminar una transacción.
#[tauri::command]
async fn delete_transaction_command(state: State<'_, AppState>, id: String) -> Result<(), String> {
    debug!("Received delete_transaction_command for ID: {}", id);
    let transactions_to_save: Vec<Transaction>;
    let mut found = false;

    {
        let mut transactions = state.transactions.lock().unwrap();
        let initial_len = transactions.len();
        transactions.retain(|t| t.id != id);
        if transactions.len() < initial_len {
            found = true;
        }
        transactions_to_save = transactions.clone();
    }

    if found {
        match save_transactions_to_file(&transactions_to_save).await {
            Ok(_) => {
                debug!("Transaction deleted and saved successfully: ID {}", id);
                Ok(())
            },
            Err(e) => {
                error!("Failed to save transactions after deletion: {}", e);
                Err(e)
            }
        }
    } else {
        error!("Transaction with ID {} not found for deletion.", id);
        Err(format!("Transacción con ID {} no encontrada.", id))
    }
}

/// Comando para obtener la lista de tiendas únicas.
#[tauri::command]
async fn get_unique_stores(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    debug!("Received get_unique_stores command.");
    let transactions = state.transactions.lock().unwrap();
    let mut unique_stores: HashSet<String> = transactions.iter()
        .map(|t| t.store_name.clone())
        .collect();
    unique_stores.insert("Todas las Tiendas".to_string());
    let mut sorted_stores: Vec<String> = unique_stores.into_iter().collect();
    sorted_stores.sort_unstable();
    debug!("Returning unique stores: {:?}", sorted_stores);
    Ok(sorted_stores)
}

/// Comando para obtener un mapa de tiendas y el número de transacciones asociadas.
#[tauri::command]
async fn get_store_info_command(state: State<'_, AppState>) -> Result<HashMap<String, usize>, String> {
    debug!("Received get_store_info_command.");
    let transactions = state.transactions.lock().unwrap();
    let mut store_counts: HashMap<String, usize> = HashMap::new();

    for transaction in transactions.iter() {
        *store_counts.entry(transaction.store_name.clone()).or_insert(0) += 1;
    }
    debug!("Returning store info: {:?}", store_counts);
    Ok(store_counts)
}

/// Comando para renombrar una tienda.
#[tauri::command]
async fn rename_store_command(
    state: State<'_, AppState>,
    old_store_name: String,
    new_store_name: String,
) -> Result<(), String> {
    debug!("Received rename_store_command: old='{}', new='{}'", old_store_name, new_store_name);
    let trimmed_old_name = old_store_name.trim();
    let trimmed_new_name = new_store_name.trim();

    if trimmed_old_name.is_empty() || trimmed_new_name.is_empty() {
        error!("Rename store: Empty old or new store name.");
        return Err("Los nombres de tienda no pueden estar vacíos.".to_string());
    }
    if trimmed_old_name == "Todas las Tiendas" {
        error!("Rename store: Attempted to rename 'Todas las Tiendas'.");
        return Err("No se puede renombrar 'Todas las Tiendas'.".to_string());
    }
    if trimmed_old_name == trimmed_new_name {
        debug!("Rename store: New name is same as old name. No operation needed.");
        return Err("El nuevo nombre de la tienda es el mismo que el anterior.".to_string());
    }

    let transactions_to_save: Vec<Transaction>;
    let mut renamed_count = 0;

    {
        let mut transactions = state.transactions.lock().unwrap();
        for transaction in transactions.iter_mut() {
            if transaction.store_name == trimmed_old_name {
                transaction.store_name = trimmed_new_name.to_owned();
                renamed_count += 1;
            }
        }
        transactions_to_save = transactions.clone();
    }

    if renamed_count > 0 {
        match save_transactions_to_file(&transactions_to_save).await {
            Ok(_) => {
                debug!("Renamed {} transactions from '{}' to '{}'. Saved successfully.", renamed_count, trimmed_old_name, trimmed_new_name);
                Ok(())
            },
            Err(e) => {
                error!("Failed to save transactions after renaming: {}", e);
                Err(e)
            }
        }
    } else {
        debug!("Rename store: Old store name '{}' not found or no transactions to rename.", trimmed_old_name);
        Err(format!("Tienda '{}' no encontrada o sin transacciones para renombrar.", trimmed_old_name))
    }
}

/// Comando para eliminar una tienda y todas sus transacciones.
#[tauri::command]
async fn delete_store_command(
    state: State<'_, AppState>,
    store_name: String,
) -> Result<(), String> {
    debug!("Received delete_store_command for store: '{}'", store_name);
    let trimmed_store_name = store_name.trim();

    if trimmed_store_name.is_empty() {
        error!("Delete store: Empty store name provided.");
        return Err("El nombre de tienda no puede estar vacío.".to_string());
    }
    if trimmed_store_name == "Todas las Tiendas" {
        error!("Delete store: Attempted to delete 'Todas las Tiendas'.");
        return Err("No se puede eliminar 'Todas las Tiendas'.".to_string());
    }

    let transactions_to_save: Vec<Transaction>;
    let initial_len;

    {
        let mut transactions = state.transactions.lock().unwrap();
        initial_len = transactions.len();
        transactions.retain(|t| t.store_name != trimmed_store_name);
        transactions_to_save = transactions.clone();
    }

    if transactions_to_save.len() < initial_len {
        match save_transactions_to_file(&transactions_to_save).await {
            Ok(_) => {
                debug!("Deleted transactions for store '{}'. Saved successfully.", trimmed_store_name);
                Ok(())
            },
            Err(e) => {
                error!("Failed to save transactions after deleting store: {}", e);
                Err(e)
            }
        }
    } else {
        debug!("Delete store: Store '{}' not found or no transactions to delete.", trimmed_store_name);
        Err(format!("Tienda '{}' no encontrada o sin transacciones para eliminar.", trimmed_store_name))
    }
}

/// Comando para llamar a la API de Google Gemini.
#[tauri::command]
async fn call_gemini_api_command(prompt: String) -> Result<String, String> {
    info!("Received call_gemini_api_command.");
    let api_key = env::var("GEMINI_API_KEY")
        .map_err(|_| {
            error!("GEMINI_API_KEY environment variable not configured.");
            "La variable de entorno GEMINI_API_KEY no está configurada.".to_string()
        })?;
    // Changed model to gemini-1.5-flash-latest
    let api_url = format!("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key={}", api_key);

    let client = Client::new();
    let chat_history = json!([
        {
            "role": "user",
            "parts": [{"text": prompt}]
        }
    ]);

    let payload = json!({
        "contents": chat_history
    });

    debug!("Enviando solicitud a Gemini API");

    let response = client.post(&api_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            error!("Network error connecting to Gemini: {}", e);
            format!("Error de red al conectar con Gemini: {}", e)
        })?;

    let response_json: serde_json::Value = response.json().await
        .map_err(|e| {
            error!("Error reading Gemini JSON response: {}", e);
            format!("Error al leer respuesta JSON de Gemini: {}", e)
        })?;

    debug!("Respuesta de Gemini API: {:?}", response_json);

    // More robust parsing for Gemini API response
    if let Some(candidates) = response_json.get("candidates").and_then(|c| c.as_array()) {
        if let Some(first_candidate) = candidates.get(0) {
            if let Some(content) = first_candidate.get("content").and_then(|c| c.as_object()) {
                if let Some(parts) = content.get("parts").and_then(|p| p.as_array()) {
                    if let Some(first_part) = parts.get(0) {
                        if let Some(text) = first_part.get("text").and_then(|t| t.as_str()) {
                            info!("Gemini API call successful.");
                            return Ok(text.to_string());
                        }
                    }
                }
            }
        }
    }
    error!("Could not extract text from Gemini AI response. Full response: {:?}", response_json);
    Err("No se pudo extraer el texto de la respuesta de la IA.".to_string())
}


/// Formatea un número f64 al estilo de moneda español (es-EA).
#[tauri::command]
fn format_currency_es_ea_command(amount: f64) -> String {
    debug!("Formatting currency: {}", amount);
    let s = format!("{:.2}", amount.abs());
    let parts: Vec<&str> = s.split('.').collect();

    let integer_part_str = parts[0];
    let decimal_part_str = if parts.len() > 1 { parts[1] } else { "00" };

    let mut formatted_integer = String::new();
    // Corrected logic for thousands separator: iterate in reverse and insert at front
    for (i, c) in integer_part_str.chars().rev().enumerate() {
        if i > 0 && i % 3 == 0 {
            formatted_integer.insert(0, '.');
        }
        formatted_integer.insert(0, c);
    }

    let final_string = format!("{},{}", formatted_integer, decimal_part_str);

    if amount < 0.0 {
        format!("-{}", final_string)
    } else {
        final_string
    }
}


// --- Función Principal de la Aplicación Tauri ---

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();
    log::info!("Tauri backend starting. Loading initial transactions...");

    let initial_transactions = match load_transactions_from_file().await {
        Ok(t) => t,
        Err(e) => {
            log::error!("Error al cargar transacciones: {}. Se iniciará con datos vacías.", e);
            Vec::new()
        }
    };

    let app_state = if initial_transactions.is_empty() {
        let mut transactions = Vec::new();
        transactions.push(Transaction {
            id: uuid::Uuid::new_v4().to_string(),
            transaction_type: TransactionType::Ingreso,
            amount: 10.00,
            description: "Transacción inicial de prueba (Rust)".to_string(),
            store_name: "Tienda de Prueba (Rust)".to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
        });
        log::info!("Añadida una transacción de prueba inicial.");
        AppState { transactions: std::sync::Mutex::new(transactions) }
    } else {
        AppState { transactions: std::sync::Mutex::new(initial_transactions) }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug) // Configure log level to Debug
                .build()
        )
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_all_transactions,
            add_transaction_command,
            update_transaction_command,
            delete_transaction_command,
            get_unique_stores,
            call_gemini_api_command,
            format_currency_es_ea_command,
            get_store_info_command,
            rename_store_command,
            delete_store_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
    Ok(())
}
