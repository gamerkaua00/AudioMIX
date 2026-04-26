import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Esta é a configuração do Vite. 
// Ele vai compilar o código React para que o Capacitor possa transformá-lo no .apk
export default defineConfig({
  base: './', // <-- Alterado para './' (Essencial para o APK não dar tela branca)
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    // "dist" é a pasta padrão onde o código final do app será gerado.
    // O Capacitor vai ler dessa pasta para montar o aplicativo Android.
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false, // Desativado para deixar o .apk mais leve
  }
});