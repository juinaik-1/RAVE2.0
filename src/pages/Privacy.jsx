import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, ShieldCheck } from 'lucide-react';
import { Button, Panel } from '../components/ui';

const CONTACT_EMAIL = 'thecorporatecoderofficial@gmail.com';

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8 dark:bg-zinc-950 sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" /> Back to Nook
        </Button>
        <div className="mt-6 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            <Play className="h-3.5 w-3.5 fill-current" />
          </span>
          Nook Privacy Policy
        </div>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Effective November 10, 2026</p>
        <Panel className="mt-5 space-y-6 p-5 text-sm leading-6 text-zinc-600 dark:text-zinc-300 sm:p-7">
          <p>
            This policy explains how Nook handles information when you use its watch-party rooms,
            sign in with Google, connect Google Drive, or use video conversion.
          </p>
          <section>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Information we use</h1>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Google sign-in information such as your email address, name, and profile image.</li>
              <li>Your chosen display name, room presence, chat messages, and playback synchronization data.</li>
              <li>Drive file identifiers and metadata needed to check, stream, or convert a video you select.</li>
              <li>Video URLs and temporary source/output files when you request conversion.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Google Drive access</h2>
            <p className="mt-2">
              If you connect Drive, Nook requests read-only access. The server uses this access to
              list and retrieve files you choose, and does not use it to change or delete your Drive
              files. Refresh credentials are encrypted on the server and are not sent to your browser.
              You can revoke Nook’s Google access in your Google Account security settings.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">How information is used and shared</h2>
            <p className="mt-2">
              Nook uses this information to authenticate users, operate rooms, synchronize playback,
              provide chat and voice features, stream selected videos, and fulfill conversion requests.
              Room participants can see room display names, chat, and shared playback. A video stream
              you share is accessible to people who receive its room stream link while it remains valid.
            </p>
            <p className="mt-2">
              Nook uses Google services for sign-in and Drive access and Supabase for room presence,
              realtime features, and chat storage. Those services process information as needed to
              provide their services under their own privacy terms.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Storage and retention</h2>
            <p className="mt-2">
              Application session tokens are stored in your browser. Encrypted Drive refresh tokens
              and temporary media files are stored on the Nook server. Stream and converted-file
              records expire and are cleaned up according to the server’s configured retention
              periods. Chat messages may remain in the configured Supabase database until removed
              by the project administrator.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Your choices</h2>
            <p className="mt-2">
              You can sign out, disconnect Drive from Nook, revoke Google access through Google,
              and avoid sharing personal information in room names or chat. Only submit video
              content that you own or are authorized to share.
            </p>
          </section>
          <section>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Contact</h2>
            <p className="mt-2">
              For privacy questions or requests, contact{' '}
              <a className="text-indigo-600 underline dark:text-indigo-400" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>.
            </p>
          </section>
          <p className="flex items-start gap-2 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            This policy describes the current Nook implementation. Update it if the app’s data
            collection, providers, retention, or contact details change.
          </p>
        </Panel>
      </article>
    </main>
  );
}
