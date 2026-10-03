import { useRegisterSW } from 'virtual:pwa-register/react'
import { useT } from '../i18n.jsx'

/**
 * The two things the page's offline copy has to say, under the header.
 *
 * Once, after the first visit: the page is now kept on this computer and
 * works without a network. And whenever a newer version has been fetched in
 * the background: that it is there, with a button to take it. It is not taken
 * on its own - that reloads the page, and a file half reviewed with it -
 * so until the button is pressed the page in use stays the one in use, and
 * the next visit after every tab is closed opens the new one anyway.
 */
export default function UpdateNotice() {
  const t = useT()
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (needRefresh) {
    return (
      <div className="sw-note" role="status">
        <span>{t('app.updateReady')}</span>
        <button type="button" className="btn sm accent-line" onClick={() => updateServiceWorker(true)}>
          {t('app.reload')}
        </button>
      </div>
    )
  }
  if (offlineReady) {
    return (
      <div className="sw-note" role="status">
        <span>{t('app.offlineReady')}</span>
        <button type="button" className="btn sm" onClick={() => setOfflineReady(false)}>
          {t('app.dismiss')}
        </button>
      </div>
    )
  }
  return null
}
