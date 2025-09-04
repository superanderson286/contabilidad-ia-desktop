import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './firebase'; // Import firebase.ts to ensure initialization and page_view event
import './i18n'; // Import i18n configuration

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
