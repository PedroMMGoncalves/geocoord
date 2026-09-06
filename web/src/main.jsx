import React from 'react'
import ReactDOM from 'react-dom/client'
// The two faces travel with the page. Fetching them from a font service would
// be a request to a third party on every visit, which is the one thing this
// page promises not to make. Latin only: Portuguese and English need nothing
// past it, and the other subsets would be copied into the build for nobody.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './index.css'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
