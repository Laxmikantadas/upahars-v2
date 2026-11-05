import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { StoreProvider } from './lib/store';
import Toaster from './components/Toaster';
import { LoginModalProvider } from './components/LoginModal';
import './styles/index.css';
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <LoginModalProvider>
            <App />
            <Toaster />
          </LoginModalProvider>
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>);