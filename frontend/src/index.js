import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeDateStorage } from './utils/dateStorage';

const root = ReactDOM.createRoot(document.getElementById('root'));
initializeDateStorage().then(() => {
  root.render(<React.StrictMode><App /></React.StrictMode>);
}).catch((error) => {
  root.render(<div role="alert">Local data could not be prepared: {error.message}. Please restart after checking the Desktop data folder and available disk space.</div>);
});
