import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { StoreProvider } from './lib/store';
import Toaster from './components/Toaster';
import './styles/index.css';
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <App />
          <Toaster />
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>);
