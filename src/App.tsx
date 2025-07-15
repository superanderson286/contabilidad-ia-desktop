import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core'; // Tauri v2 API
import { open } from '@tauri-apps/plugin-shell'; // Tauri v2 API
import { getCurrentWindow } from '@tauri-apps/api/window'; // Importado para el evento tauri://ready y control de ventana

// Declare global interface for __TAURI_IPC__ to resolve TypeScript error
// This tells TypeScript that `__TAURI_IPC__` might exist on the `window` object.
declare global {
  interface Window {
    __TAURI_IPC__?: Function; // Tauri IPC function
  }
}

// Definiciones de tipos para las transacciones (deben coincidir con Rust)
interface Transaction {
  id: string;
  type: 'Ingreso' | 'Gasto';
  amount: number;
  description: string;
  store_name: string;
  timestamp: number;
}

// Función de formato de moneda síncrona en JavaScript
const formatCurrencyJs = (amount: number): string => {
  const s = amount.toFixed(2);
  const parts = s.split('.');

  let integerPartStr = parts[0];
  const decimalPartStr = parts.length > 1 ? parts[1] : '00';

  let formattedInteger = '';
  const len = integerPartStr.length;

  for (let i = 0; i < len; i++) {
    formattedInteger += integerPartStr[i];
    // Asegura que el punto no se añada al final del número entero.
    // Solo añade un punto si no es el último dígito y quedan múltiplos de 3 dígitos después.
    if ((len - 1 - i) % 3 === 0 && i !== len - 1) {
      formattedInteger += '.';
    }
  }

  const finalString = `${formattedInteger},${decimalPartStr}`;

  if (amount < 0.0) {
    return `-${finalString}`;
  } else {
    return finalString;
  }
};


function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allStores, setAllStores] = useState<string[]>(['Todas las Tiendas']);
  const [selectedStoreIndex, setSelectedStoreIndex] = useState(0);
  const [currentTab, setCurrentTab] = useState('input');
  const [statusMessage, setStatusMessage] = useState('');

  // Estados para la nueva transacción
  const [newAmount, setNewAmount] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newStore, setNewStore] = useState(''); // Campo de texto para escribir/mostrar la tienda
  const [newType, setNewType] = useState<'Ingreso' | 'Gasto'>('Ingreso');

  // Estados para la IA
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Estados para el modal de edición
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStore, setEditStore] = useState('');
  const [editType, setEditType] = useState<'Ingreso' | 'Gasto'>('Ingreso');

  // Estados para el modal de eliminación
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  // Estados para la gestión de tiendas
  const [storeEditModal, setStoreEditModal] = useState(false);
  const [storeDeleteModal, setStoreDeleteModal] = useState(false);
  const [storeToEdit, setStoreToEdit] = useState<string | null>(null);
  const [storeToDelete, setStoreToDelete] = useState<string | null>(null);
  const [newStoreName, setNewStoreName] = useState('');
  const [storeInfoMap, setStoreInfoMap] = useState<Record<string, number>>({});
  
  // Estado para el resumen de IA
  const [iaSummary, setIaSummary] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Obtener la instancia de la ventana actual de Tauri
  const appWindow = getCurrentWindow();

  // Funciones de control de ventana (restauradas para la barra de título personalizada)
  const handleMinimize = useCallback(async () => {
    await appWindow.minimize();
  }, [appWindow]);

  const handleClose = useCallback(async () => {
    await appWindow.close();
  }, [appWindow]);

  const handleMaximizeToggle = useCallback(async () => {
    const isMaximized = await appWindow.isMaximized();
    isMaximized ? await appWindow.unmaximize() : await appWindow.maximize();
  }, [appWindow]);

  // Función para analizar transacciones con IA
  const handleAnalizarConIA = async () => {
    setAnalyzing(true);
    setIaSummary(null);

    const resumenPrompt = `
Eres un experto financiero que debe analizar el siguiente JSON de transacciones (ingresos y gastos) y generar un informe en español con:

1. Totales de ingresos y egresos
2. Categoría/tienda más frecuente
3. Transacción más alta
4. ¿Hubo ahorro? ¿Cuál fue el balance final?
5. Un consejo útil personalizado

Transacciones:
${JSON.stringify(transactions, null, 2)}
`;

    try {
      const result = await invoke<string>('call_gemini_api_command', { prompt: resumenPrompt });
      setIaSummary(result);
    } catch (error) {
      setIaSummary('❌ Hubo un error al analizar con la IA.');
      console.error('Frontend: Error al analizar con IA:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  // --- Funciones para interactuar con el backend de Rust ---

  const fetchTransactions = useCallback(async () => {
    console.log('Frontend: Calling get_all_transactions...');
    try {
      const result: Transaction[] = await invoke('get_all_transactions');
      console.log('Frontend: get_all_transactions successful, received:', result.length, 'transactions. Data:', result);
      setTransactions(result);
      console.log('Frontend: Transactions state updated. Current transactions length:', result.length);
    } catch (e: any) {
      console.error('Frontend: Error fetching transactions:', e);
      setStatusMessage(`Error al cargar transacciones: ${e}`);
    }
  }, []);

  const fetchUniqueStores = useCallback(async () => {
    console.log('Frontend: Calling get_unique_stores...');
    try {
      const result: string[] = await invoke('get_unique_stores');
      console.log('Frontend: get_unique_stores successful, received:', result);
      // Asegurarse de que 'Todas las Tiendas' esté siempre al principio si existe
      const filteredResult = result.filter(s => s !== 'Todas las Tiendas');
      setAllStores(['Todas las Tiendas', ...filteredResult.sort()]);
      console.log('Frontend: allStores state updated to:', ['Todas las Tiendas', ...filteredResult.sort()]);
    } catch (e: any) {
      console.error('Frontend: Error fetching unique stores:', e);
      setStatusMessage(`Error al cargar tiendas: ${e}`);
    }
  }, []);

  const fetchStoreInfo = useCallback(async () => {
    console.log('Frontend: Calling get_store_info_command...');
    try {
      const result: Record<string, number> = await invoke("get_store_info_command");
      console.log('Frontend: get_store_info_command successful, received:', result);
      setStoreInfoMap(result);
    } catch (e) {
      console.error("Frontend: Error al cargar info de tiendas:", e);
      setStatusMessage(`Error al cargar información de tiendas: ${e}`);
    }
  }, []);

  // Cargar datos iniciales AL MONTAR el componente y CUANDO TAURI ESTÉ LISTO
  useEffect(() => {
    const initializeAppData = async () => {
      console.log('Frontend: App initialization started.');
      appWindow.once('tauri://ready', () => {
        console.log('Frontend: tauri://ready event received!');
        if (typeof window.__TAURI_IPC__ === 'function') {
          console.log('Frontend: __TAURI_IPC__ is a function AFTER tauri://ready. Fetching data...');
          fetchTransactions();
          fetchUniqueStores(); // Esto debería poblar allStores
          fetchStoreInfo();
          setNewStore(''); // Asegurar que el campo de texto esté vacío al inicio
          console.log('Frontend: Initial data fetch commands sent.');
        } else {
          console.error('Frontend: __TAURI_IPC__ is STILL NOT a function AFTER tauri://ready. This is a critical error.');
          setStatusMessage('Error crítico: El puente de comunicación de Tauri no está disponible.');
        }
      });
      console.log('Frontend: Waiting for tauri://ready event...');
    };

    initializeAppData();
  }, [appWindow, fetchTransactions, fetchUniqueStores, fetchStoreInfo]); // Dependencias para useCallback

  // Actualizar tiendas únicas cuando cambian las transacciones (sin dependencias asíncronas)
  useEffect(() => {
    console.log('Frontend: allStores state or selectedStoreIndex changed. Current allStores:', allStores);
    const currentStoreName = allStores[selectedStoreIndex];
    if (!allStores.includes(currentStoreName)) {
      setSelectedStoreIndex(allStores.indexOf('Todas las Tiendas'));
    }
  }, [allStores, selectedStoreIndex]);

  // Refrescar info de tiendas y transacciones cuando la pestaña cambia
  useEffect(() => {
    console.log(`Frontend: Tab changed to ${currentTab}. Re-fetching data...`);
    // Asegurarse de que fetchUniqueStores se llama también para la pestaña 'input'
    if (currentTab === 'summary' || currentTab === 'stores' || currentTab === 'input') {
      fetchTransactions();
      fetchUniqueStores();
      fetchStoreInfo();
    }
  }, [currentTab, fetchTransactions, fetchUniqueStores, fetchStoreInfo]); // Dependencias para re-fetch al cambiar de pestaña

  // --- Lógica de la Interfaz de Usuario ---

  const handleAddTransaction = async () => {
    console.log('Frontend: handleAddTransaction called.');
    // Usamos el valor de 'newStore' (el campo de texto) para la transacción
    if (!newAmount || !newDescription.trim() || !newStore.trim()) {
      setStatusMessage('Todos los campos (Monto, Descripción, Tienda) son obligatorios.');
      console.warn('Frontend: Add transaction failed due to missing fields.');
      return;
    }

    const amountNum = parseFloat(newAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setStatusMessage('Monto inválido. Introduce un número positivo.');
      console.warn('Frontend: Add transaction failed due to invalid amount.');
      return;
    }

    try {
      console.log('Frontend: Calling add_transaction_command with:', { newType, amountNum, newDescription, newStore });
      const newTrans: Transaction = await invoke('add_transaction_command', {
        transactionTypeStr: newType,
        amount: amountNum,
        description: newDescription.trim(),
        storeName: newStore.trim(),
      });
      console.log('Frontend: add_transaction_command successful, new transaction:', newTrans);
      setTransactions((prev) => [...prev, newTrans]);
      setStatusMessage(`✅ Transacción registrada: ${newType} ${formatCurrencyJs(amountNum)}`);
      // Limpiar campos
      setNewAmount('');
      setNewDescription('');
      setNewStore(''); // Limpiar el campo de texto
      setNewType('Ingreso');
    } catch (e: any) {
      console.error('Frontend: Error adding transaction:', e);
      setStatusMessage(`Error al añadir transacción: ${e}`);
    } finally {
      // Siempre refrescar tiendas e información de tiendas después de añadir, incluso si hubo un error
      fetchUniqueStores();
      fetchStoreInfo();
    }
  };

  const handleEditTransaction = (transaction: Transaction) => {
    console.log('Frontend: handleEditTransaction called for ID:', transaction.id);
    setEditingTransaction(transaction);
    setEditAmount(transaction.amount.toString());
    setEditDescription(transaction.description);
    setEditStore(transaction.store_name);
    setEditType(transaction.type);
    setShowEditModal(true);
  };

  const handleUpdateTransaction = async () => {
    console.log('Frontend: handleUpdateTransaction called.');
    if (!editingTransaction) return;

    if (!editAmount || !editDescription.trim() || !editStore.trim()) {
      setStatusMessage('Todos los campos son obligatorios para editar.');
      console.warn('Frontend: Update transaction failed due to missing fields.');
      return;
    }

    const amountNum = parseFloat(editAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setStatusMessage('Monto de edición inválido. Introduce un número positivo.');
      console.warn('Frontend: Update transaction failed due to invalid amount.');
      return;
    }

    try {
      console.log('Frontend: Calling update_transaction_command with:', { id: editingTransaction.id, editType, amountNum, editDescription, editStore });
      const updatedTrans: Transaction = await invoke('update_transaction_command', {
        id: editingTransaction.id,
        transactionTypeStr: editType,
        amount: amountNum,
        description: editDescription.trim(),
        storeName: editStore.trim(),
      });
      console.log('Frontend: update_transaction_command successful, updated transaction:', updatedTrans);
      setTransactions((prev) =>
        prev.map((t) => (t.id === updatedTrans.id ? updatedTrans : t))
      );
      setStatusMessage(`✅ Transacción ${updatedTrans.id.substring(0, 8)} actualizada.`);
      setShowEditModal(false);
      setEditingTransaction(null);
    } catch (e: any) {
      console.error('Frontend: Error updating transaction:', e);
      setStatusMessage(`Error al actualizar transacción: ${e}`);
    } finally {
      fetchUniqueStores();
      fetchStoreInfo();
    }
  };

  const handleDeleteTransaction = (id: string) => {
    console.log('Frontend: handleDeleteTransaction called for ID:', id);
    setDeletingTransactionId(id);
    setShowDeleteModal(true);
  };

  const confirmDeleteTransaction = async () => {
    console.log('Frontend: confirmDeleteTransaction called. ID to delete:', deletingTransactionId);
    if (!deletingTransactionId) {
      console.warn('Frontend: Delete transaction failed: no ID to delete.');
      return;
    }
    try {
      console.log('Frontend: Calling delete_transaction_command with ID:', deletingTransactionId);
      await invoke('delete_transaction_command', { id: deletingTransactionId });
      console.log('Frontend: delete_transaction_command successful.');
      setTransactions((prev) => prev.filter((t) => t.id !== deletingTransactionId));
      setStatusMessage(`🗑️ Transacción ${deletingTransactionId.substring(0, 8)} eliminada.`);
      setShowDeleteModal(false);
      setDeletingTransactionId(null);
    } catch (e: any) {
      console.error('Frontend: Error deleting transaction:', e);
      setStatusMessage(`Error al eliminar transacción: ${e}`);
    } finally {
      fetchUniqueStores();
      fetchStoreInfo();
    }
  };

  const handleRenameStore = async () => {
    console.log('Frontend: handleRenameStore called. Old:', storeToEdit, 'New:', newStoreName);
    if (!storeToEdit || !newStoreName.trim()) {
      setStatusMessage('El nombre de la tienda no puede estar vacío.');
      console.warn('Frontend: Rename store failed due to empty name.');
      return;
    }
    if (storeToEdit === "Todas las Tiendas") {
      setStatusMessage("No se puede renombrar 'Todas las Tiendas'.");
      console.warn("Frontend: Rename store failed for 'Todas las Tiendas'.");
      return;
    }
    if (newStoreName.trim() === "") { // New check for empty new store name
        setStatusMessage("El nuevo nombre de la tienda no puede estar vacío.");
        console.warn("Frontend: Rename store failed due to empty new name.");
        return;
    }
    if (storeToEdit === newStoreName.trim()) {
      setStatusMessage("El nuevo nombre de la tienda es el mismo que el anterior.");
      console.warn("Frontend: Rename store failed: same name.");
      return;
    }

    try {
      console.log('Frontend: Calling rename_store_command with:', { oldStoreName: storeToEdit, newStoreName: newStoreName.trim() });
      await invoke("rename_store_command", {
        oldStoreName: storeToEdit,
        newStoreName: newStoreName.trim(),
      });
      console.log('Frontend: rename_store_command successful.');
      // Update transactions in frontend state to reflect the renamed store
      setTransactions((prev) =>
        prev.map((t) =>
          t.store_name === storeToEdit ? { ...t, store_name: newStoreName.trim() } : t
        )
      );
      setStatusMessage(`🏪 Tienda renombrada a: ${newStoreName}`);
      setStoreEditModal(false);
      setStoreToEdit(null);
      setNewStoreName('');
    } catch (e: any) {
      console.error("Frontend: Error al renombrar tienda:", e);
      setStatusMessage(`Error al renombrar tienda: ${e}`);
    } finally {
      // Siempre refrescar tiendas e información de tiendas después de renombrar, incluso si hubo un error
      fetchUniqueStores();
      fetchStoreInfo();
    }
  };

  const confirmDeleteStore = async () => {
    console.log('Frontend: confirmDeleteStore called. Store to delete:', storeToDelete);
    if (!storeToDelete) {
      console.warn('Frontend: Delete store failed: no store selected.');
      return;
    }
    if (storeToDelete === "Todas las Tiendas") {
      setStatusMessage("No se puede eliminar 'Todas las Tiendas'.");
      setStoreDeleteModal(false);
      console.warn("Frontend: Delete store failed for 'Todas las Tiendas'.");
      return;
    }

    try {
      console.log('Frontend: Calling delete_store_command with:', { storeName: storeToDelete });
      await invoke("delete_store_command", { storeName: storeToDelete });
      console.log('Frontend: delete_store_command successful.');
      setTransactions((prev) => prev.filter((t) => t.store_name !== storeToDelete)); // Filter out transactions for the deleted store
      setStatusMessage(`🗑️ Tienda eliminada: ${storeToDelete}`);
      setStoreDeleteModal(false);
      setStoreToDelete(null);
    } catch (e: any) {
      console.error("Frontend: Error al eliminar tienda:", e);
      setStatusMessage(`Error al eliminar tienda: ${e}`);
    } finally {
      // Siempre refrescar tiendas e información de tiendas después de eliminar, incluso si hubo un error
      fetchUniqueStores();
      fetchStoreInfo();
    }
  };

  const handleAiQuestion = async () => {
    console.log('Frontend: handleAiQuestion called.');
    if (!aiQuestion.trim()) {
      setStatusMessage('Por favor, escribe una pregunta para la IA.');
      console.warn('Frontend: AI query failed: empty question.');
      return;
    }
    setAiLoading(true);
    setAiResponse('');
    setAiError('');
    setStatusMessage('Consultando a la IA... por favor espera.');
    try {
      console.log('Frontend: Calling call_gemini_api_command with prompt:', aiQuestion.trim());
      const response: string = await invoke('call_gemini_api_command', { prompt: aiQuestion.trim() });
      console.log('Frontend: call_gemini_api_command successful, response length:', response.length);
      setAiResponse(response);
      setStatusMessage('Consulta a la IA completada.');
    } catch (e: any) {
      console.error('Frontend: Error calling AI:', e);
      setAiError(`Error al consultar IA: ${e}`);
      setStatusMessage(`Error al consultar IA: ${e}`);
    } finally {
      setAiLoading(false);
    }
  };

  const filteredTransactions = allStores[selectedStoreIndex] === 'Todas las Tiendas'
    ? transactions
    : transactions.filter(t => t.store_name === allStores[selectedStoreIndex]);

  const totalIngresos = filteredTransactions
    .filter(t => t.type === 'Ingreso')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalGastos = filteredTransactions
    .filter(t => t.type === 'Gasto')
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = totalIngresos - totalGastos;

  const getLocalFormattedDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000); // Convert Unix timestamp to milliseconds
    return date.toLocaleString(); // Uses user's local time and format
  };

  return (
    // Contenedor principal con fondo oscuro y texto claro
    <div className="relative min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center overflow-hidden">
      {/* Custom Title Bar (Restaurada) */}
      <div
        data-tauri-drag-region
        className="h-8 bg-gray-800 bg-opacity-70 backdrop-blur-sm w-full flex justify-between items-center px-4"
      >
        <span className="text-sm font-semibold text-gray-300">Contabilidad IA App</span>
        <div className="flex space-x-1">
          <button
            onClick={handleMinimize}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700"
            aria-label="Minimizar"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button
            onClick={handleMaximizeToggle}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-700"
            aria-label="Maximizar/Restaurar"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
          </button>
          <button
            onClick={handleClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500"
            aria-label="Cerrar"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col items-center p-6 w-full flex-grow">
        {/* Header */}
        <h1 className="text-3xl font-bold text-blue-400 mb-6">
          📊 Gestor de Contabilidad Multi-Tienda con IA
        </h1>

        {/* Tabs */}
        <div className="flex bg-gray-800 rounded-lg p-2 space-x-4 mb-6">
          <button
            onClick={() => setCurrentTab('input')}
            className={`px-4 py-2 rounded-md font-semibold transition-colors ${
              currentTab === 'input' ? 'bg-blue-600 text-white shadow-md' : 'text-blue-200 hover:bg-gray-700'
            }`}
          >
            ➕ Ingresar Transacción
          </button>
          <button
            onClick={() => setCurrentTab('summary')}
            className={`px-4 py-2 rounded-md font-semibold transition-colors ${
              currentTab === 'summary' ? 'bg-blue-600 text-white shadow-md' : 'text-blue-200 hover:bg-gray-700'
            }`}
          >
            📈 Resumen y Reportes
          </button>
          <button
            onClick={() => setCurrentTab('ai')}
            className={`px-4 py-2 rounded-md font-semibold transition-colors ${
              currentTab === 'ai' ? 'bg-blue-600 text-white shadow-md' : 'text-blue-200 hover:bg-gray-700'
            }`}
          >
            🤖 Preguntar a la IA
          </button>
          <button
            onClick={() => setCurrentTab('stores')}
            className={`px-4 py-2 rounded-md font-semibold transition-colors ${
              currentTab === 'stores' ? 'bg-blue-600 text-white shadow-md' : 'text-blue-200 hover:bg-gray-700'
            }`}
          >
            🏪 Gestionar Tiendas
          </button>
          <button
              onClick={() => open('https://contabilidad-ia-web.vercel.app/')}
              className="px-4 py-2 rounded-md font-semibold text-blue-200 hover:bg-gray-700 transition-colors ml-auto"
          >
              🌐 Visitar la Web
          </button>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div className="bg-orange-500 text-white p-3 rounded-md mb-6 w-full max-w-2xl text-center shadow-lg">
            {statusMessage}
          </div>
        )}

        {/* Tab Content */}
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-4xl flex-grow overflow-y-auto">
          {currentTab === 'input' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-200 mb-6">📝 Registrar Nueva Transacción</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="new-amount" className="block text-gray-300 text-sm font-bold mb-2">Monto:</label>
                  <input
                    id="new-amount"
                    type="number"
                    step="0.01"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                    placeholder="Ej: 100.50"
                  />
                </div>
                <div>
                  <label htmlFor="new-description" className="block text-gray-300 text-sm font-bold mb-2">Descripción:</label>
                  <input
                    id="new-description"
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                    placeholder="Ej: Compra de materiales"
                  />
                </div>
                <div>
                  <label htmlFor="new-store-name-input" className="block text-gray-300 text-sm font-bold mb-2">Nombre de la Tienda:</label>
                  <input
                    id="new-store-name-input"
                    type="text"
                    value={newStore}
                    onChange={(e) => setNewStore(e.target.value)}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                    placeholder="Ej: Supermercado XYZ"
                  />
                  <label htmlFor="new-store-select" className="block text-gray-300 text-sm font-bold mt-4 mb-2">O selecciona una existente:</label>
                  <select
                    id="new-store-select"
                    value={newStore} // Ahora el select también se vincula a newStore
                    onChange={(e) => setNewStore(e.target.value)} // Y lo actualiza directamente
                    className="block w-full mt-2 py-2 px-3 rounded-md bg-gray-700 border-gray-600 text-gray-100 focus:outline-none focus:shadow-outline"
                    key={allStores.length > 0 ? allStores.join('-') : 'empty'} // Mantiene la clave para forzar re-render
                  >
                    <option value="">Selecciona una tienda existente...</option>
                    {allStores
                      .filter((s) => s !== 'Todas las Tiendas')
                      .map((store) => (
                        <option key={store} value={store}>
                          {store}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Puedes escribir un nuevo nombre o seleccionar uno existente.</p>
                </div>
                <fieldset className="flex flex-col">
                  <legend className="block text-gray-300 text-sm font-bold mb-2">Tipo de Transacción:</legend>
                  <div className="flex space-x-4">
                    <label htmlFor="new-type-ingreso" className="inline-flex items-center">
                      <input
                        id="new-type-ingreso"
                        type="radio"
                        className="form-radio text-blue-600"
                        name="transactionType"
                        value="Ingreso"
                        checked={newType === 'Ingreso'}
                        onChange={() => setNewType('Ingreso')}
                      />
                      <span className="ml-2 text-gray-100">Ingreso</span>
                    </label>
                    <label htmlFor="new-type-gasto" className="inline-flex items-center">
                      <input
                        id="new-type-gasto"
                        type="radio"
                        className="form-radio text-blue-600"
                        name="transactionType"
                        value="Gasto"
                        checked={newType === 'Gasto'}
                        onChange={() => setNewType('Gasto')}
                      />
                      <span className="ml-2 text-gray-100">Gasto</span>
                    </label>
                  </div>
                </fieldset>
              </div>
              <div className="mt-8 text-center">
                <button
                  onClick={handleAddTransaction}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-colors text-lg"
                >
                  ✅ Registrar Transacción
                </button>
              </div>
            </div>
          )}

          {currentTab === 'summary' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-200 mb-6">📈 Resumen y Reportes</h2>
              <div className="flex items-center mb-6">
                <label htmlFor="store-selector" className="block text-gray-300 text-sm font-bold mr-3">Seleccionar Tienda:</label>
                <select
                  id="store-selector"
                  value={selectedStoreIndex}
                  onChange={(e) => setSelectedStoreIndex(parseInt(e.target.value))}
                  className="flex-grow py-2 px-3 rounded-md bg-gray-700 border-gray-600 text-gray-100 focus:outline-none focus:shadow-outline"
                >
                  {allStores.map((store, index) => (
                    <option key={store} value={index}>
                      {store}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-gray-700 p-4 rounded-lg shadow-inner mb-6">
                <h3 className="text-xl font-bold text-blue-300 mb-2">
                  Tienda Seleccionada: {allStores[selectedStoreIndex]}
                </h3>
                <p className="text-gray-200">Total Ingresos: {formatCurrencyJs(totalIngresos)}</p>
                <p className="text-gray-200">Total Gastos: {formatCurrencyJs(totalGastos)}</p>
                <p className={`text-lg font-bold ${balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  Balance Actual: {formatCurrencyJs(balance)}
                </p>
              </div>

              <div className="mt-6 text-center">
                  <button
                    onClick={handleAnalizarConIA}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all"
                  >
                    📊 Analizar transacciones con IA
                  </button>
                </div>

                {analyzing && (
                  <div className="mt-4 text-sm text-gray-400 text-center">Analizando con Gemini…</div>
                )}

                {iaSummary && (
                  <div className="mt-6 p-4 border border-indigo-300 bg-indigo-50 text-indigo-900 rounded-md shadow-md whitespace-pre-wrap">
                    <h2 className="font-semibold text-lg mb-2">🧠 Informe IA</h2>
                    {iaSummary}
                  </div>
                )}

              <h3 className="text-xl font-bold text-gray-200 mt-8 mb-4">Últimas Transacciones:</h3>
              <div className="max-h-80 overflow-y-auto bg-gray-700 rounded-lg shadow-inner">
                <table className="min-w-full divide-y divide-gray-600">
                  <thead className="bg-gray-600 sticky top-0">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Fecha/Hora</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Tipo/Monto</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Descripción/Tienda</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {filteredTransactions.length > 0 ? (
                      filteredTransactions.slice().reverse().map((t) => (
                        <tr key={t.id} className="hover:bg-gray-600 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{getLocalFormattedDate(t.timestamp)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`font-semibold ${t.type === 'Ingreso' ? 'text-green-300' : 'text-red-300'}`}>
                              {t.type} {formatCurrencyJs(t.amount)}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{t.description} ({t.store_name})</td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => handleEditTransaction(t)}
                              className="text-indigo-400 hover:text-indigo-600 mr-3"
                            >
                              ✏️ Editar
                            </button>
                            <button
                              onClick={() => handleDeleteTransaction(t.id)}
                              className="text-red-400 hover:text-red-600"
                            >
                              🗑️ Eliminar
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-4 text-center text-gray-400">
                          No hay transacciones registradas para esta tienda.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {currentTab === 'stores' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-200 mb-6">🏪 Gestor de Tiendas</h2>
              <div className="space-y-4">
                {Object.entries(storeInfoMap).length > 0 ? (
                  Object.entries(storeInfoMap).map(([store, count]) => (
                    <div key={store} className="bg-gray-700 rounded-lg p-4 flex justify-between items-center shadow-sm">
                      <div>
                        <p className="text-lg text-gray-100 font-semibold">{store}</p>
                        <p className="text-sm text-gray-400">Transacciones: {count}</p>
                      </div>
                      <div className="flex space-x-3">
                        <button
                          onClick={() => {
                            setStoreToEdit(store);
                            setNewStoreName(store);
                            setStoreEditModal(true);
                          }}
                          className="text-indigo-400 hover:text-indigo-600"
                        >
                          ✏️ Renombrar
                        </button>
                        <button
                          onClick={() => {
                            setStoreToDelete(store);
                            setStoreDeleteModal(true);
                          }}
                          className="text-red-400 hover:text-red-600"
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-gray-400">No hay tiendas registradas.</p>
                )}
              </div>
            </div>
          )}  
            {currentTab === 'ai' && (
              <div>
                <h2 className="text-2xl font-bold text-gray-200 mb-6">🤖 Preguntar a la IA sobre Contabilidad</h2>
                <div className="mb-4">
                  <label htmlFor="ai-question" className="block text-gray-300 text-sm font-bold mb-2">Tu pregunta:</label>
                  <textarea
                    id="ai-question"
                    value={aiQuestion}
                    onChange={(e) => setAiQuestion(e.target.value)}
                    rows={5}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                    placeholder="Ej: ¿Cuál fue mi gasto total el mes pasado?"
                  />
                </div>
                <div className="text-center mb-6">
                  <button
                    onClick={handleAiQuestion}
                    disabled={aiLoading}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition-colors text-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {aiLoading ? 'Cargando...' : '🤔 Pregúntame algo'}
                  </button>
                </div>

                {aiLoading && (
                  <div className="text-center text-blue-400">Cargando respuesta de la IA...</div>
                )}
                {aiError && (
                  <div className="bg-red-500 text-white p-3 rounded-md mt-4">
                    Error: {aiError}
                  </div>
                )}
                {aiResponse && (
                  <div className="bg-gray-700 p-4 rounded-lg shadow-inner mt-4 max-h-64 overflow-y-auto">
                    <h3 className="text-xl font-bold text-gray-200 mb-2">Respuesta de la IA:</h3>
                    <p className="text-gray-300 whitespace-pre-wrap">{aiResponse}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Edit Transaction Modal */}
        {showEditModal && editingTransaction && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-lg">
              <h2 className="text-2xl font-bold text-gray-200 mb-6">Modificar Transacción</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="edit-amount" className="block text-gray-300 text-sm font-bold mb-2">Monto:</label>
                  <input
                    id="edit-amount"
                    type="number"
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                  />
                </div>
                <div>
                  <label htmlFor="edit-description" className="block text-gray-300 text-sm font-bold mb-2">Descripción:</label>
                  <input
                    id="edit-description"
                    type="text"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                  />
                </div>
                <div>
                  <label htmlFor="edit-store" className="block text-gray-300 text-sm font-bold mb-2">Tienda:</label>
                  <input
                    id="edit-store"
                    type="text"
                    value={editStore}
                    onChange={(e) => setEditStore(e.target.value)}
                    className="shadow appearance-none border rounded w-full py-2 px-3 leading-tight focus:outline-none focus:shadow-outline bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                  />
                </div>
                <fieldset className="flex flex-col">
                  <legend className="block text-gray-300 text-sm font-bold mb-2">Tipo:</legend>
                  <div className="flex space-x-4">
                    <label htmlFor="edit-type-ingreso" className="inline-flex items-center">
                      <input
                        id="edit-type-ingreso"
                        type="radio"
                        className="form-radio text-blue-600"
                        name="editTransactionType"
                        value="Ingreso"
                        checked={editType === 'Ingreso'}
                        onChange={() => setEditType('Ingreso')}
                      />
                      <span className="ml-2 text-gray-100">Ingreso</span>
                    </label>
                    <label htmlFor="edit-type-gasto" className="inline-flex items-center">
                      <input
                        id="edit-type-gasto"
                        type="radio"
                        className="form-radio text-blue-600"
                        name="editTransactionType"
                        value="Gasto"
                        checked={editType === 'Gasto'}
                        onChange={() => setEditType('Gasto')}
                      />
                      <span className="ml-2 text-gray-100">Gasto</span>
                    </label>
                  </div>
                </fieldset>
              </div>
              <div className="mt-8 flex justify-end space-x-4">
                <button
                  onClick={handleUpdateTransaction}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors"
                >
                  💾 Guardar Cambios
                </button>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors"
                >
                  ❌ Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md text-center">
              <h2 className="text-2xl font-bold text-red-400 mb-6">¡Atención!</h2>
              <p className="text-gray-200 mb-8">¿Estás seguro de que quieres eliminar esta transacción?</p>
              <div className="flex justify-center space-x-6">
                <button
                  onClick={confirmDeleteTransaction}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors"
                >
                  ✅ Sí, Eliminar
                </button>
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg shadow-md transition-colors"
                >
                  ❌ Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rename Store Modal */}
        {storeEditModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-gray-800 p-6 rounded-lg w-full max-w-md shadow-xl">
              <h2 className="text-2xl text-gray-200 font-bold mb-4">✏️ Renombrar Tienda</h2>
              <p className="text-gray-300 mb-4">Renombrando: <span className="font-semibold text-blue-300">{storeToEdit}</span></p>
              <div>
                <label htmlFor="new-store-name-modal" className="block text-gray-300 text-sm font-bold mb-2">Nuevo nombre de la tienda:</label>
                <input
                  id="new-store-name-modal"
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="w-full py-2 px-3 rounded bg-gray-700 text-white placeholder-gray-400 mb-6"
                  placeholder="Nuevo nombre de tienda"
                />
              </div>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={handleRenameStore}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg"
                >
                  Guardar
                </button>
                <button
                  onClick={() => setStoreEditModal(false)}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Store Confirmation Modal */}
        {storeDeleteModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-gray-800 p-6 rounded-lg w-full max-w-md shadow-xl text-center">
              <h2 className="text-2xl text-red-400 font-bold mb-4">🗑️ Eliminar Tienda</h2>
              <p className="text-gray-100 mb-6">¿Seguro que quieres eliminar la tienda “<span className="font-semibold text-red-300">{storeToDelete}</span>” y todas sus transacciones?</p>
              <div className="flex justify-center space-x-6">
                <button
                  onClick={confirmDeleteStore}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg"
                >
                  Eliminar
                </button>
                <button
                  onClick={() => setStoreDeleteModal(false)}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    //</div>
  );
}

export default App;
