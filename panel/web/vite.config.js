import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // aset relatif - aman dipakai di subpath / host mana pun
  plugins: [react()],
  build: { outDir: '../public', emptyOutDir: true }
})
