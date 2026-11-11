import { useCallback, useState } from 'react';
import { api } from '../utils/api';

let pickerReady;

function ensurePickerReady() {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((resolve, reject) => {
    if (!window.gapi?.load) {
      reject(new Error('Google Picker could not load. Check the Google API script and try again.'));
      return;
    }
    window.gapi.load('picker', { callback: resolve });
  });
  return pickerReady;
}

export function useDrivePicker(onPicked) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const connectDrive = useCallback(async () => {
    setBusy(true);
    setStatus('Connecting to Google Drive…');
    setError('');
    try {
      const { authUrl } = await api.post('/api/drive/connect', {
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
      window.location.assign(authUrl);
    } catch (requestError) {
      setBusy(false);
      setStatus('');
      setError(requestError.message || 'Unable to connect Google Drive.');
    }
  }, []);

  const openPicker = useCallback(async () => {
    setBusy(true);
    setStatus('Opening Google Drive picker…');
    setError('');
    try {
      const [tokenResult] = await Promise.all([
        api.get('/api/drive/picker-token'),
        ensurePickerReady(),
      ]);
      const google = window.google?.picker;
      if (!google) throw new Error('Google Picker is unavailable.');
      if (!import.meta.env.VITE_GOOGLE_API_KEY || !import.meta.env.VITE_GOOGLE_APP_ID) {
        throw new Error('Google Picker requires VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID.');
      }

      const allFilesView = new google.DocsView(google.ViewId.DOCS);
      allFilesView.setIncludeFolders(true);
      allFilesView.setOwnedByMe(true);
      const videosView = new google.DocsView(google.ViewId.DOCS_VIDEOS);
      videosView.setIncludeFolders(true);
      videosView.setOwnedByMe(true);
      const builder = new google.PickerBuilder()
        .setDeveloperKey(import.meta.env.VITE_GOOGLE_API_KEY)
        .setOAuthToken(tokenResult.accessToken)
        .setTitle('Choose a video from your Google Drive')
        .addView(videosView)
        .addView(allFilesView)
        .setCallback(async (data) => {
          if (data.action === google.Action.ERROR) {
            setError('Google Drive could not load files. Reconnect Drive and approve read-only access to all Drive files. Confirm the Picker account is the same Google account that owns or received the videos.');
            setBusy(false);
            setStatus('');
            return;
          }
          if (data.action !== google.Action.PICKED || !data.docs?.[0]) {
            setBusy(false);
            setStatus('');
            return;
          }
          setStatus('Checking video format using Drive range requests. Large files no longer need a full download just to be checked.');
          try {
            const result = await api.post('/api/streams', { fileId: data.docs[0].id });
            onPicked?.(result);
          } catch (requestError) {
            setError(requestError.message || 'Unable to register this Drive video.');
          } finally {
            setBusy(false);
            setStatus('');
          }
        });
      builder.setAppId(import.meta.env.VITE_GOOGLE_APP_ID);
      builder.build().setVisible(true);
    } catch (requestError) {
      setBusy(false);
      setStatus('');
      if (requestError.status === 409) {
        await connectDrive();
        return;
      }
      setError(requestError.message || 'Unable to open Google Drive Picker.');
    }
  }, [connectDrive, onPicked]);

  return { openPicker, connectDrive, busy, error, status, clearError: () => setError('') };
}
